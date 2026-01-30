'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  generateRageMessage,
  type GenerateRageMessageOutput,
} from '@/ai/flows/generate-rage-message';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useFirebase,
  useUser,
  useFirestore,
  useCollection,
  useDoc,
  initiateAnonymousSignIn,
  addDocumentNonBlocking,
  setDocumentNonBlocking,
  useMemoFirebase,
} from '@/firebase';
import { collection, doc, query, orderBy, limit } from 'firebase/firestore';
import { Coffee, Crown } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

type GameState = 'idle' | 'playing' | 'stopped';

type Result = {
  finalTime: number;
  delta: number;
  aiResponse: GenerateRageMessageOutput | null;
};

// From backend.json entities
type Attempt = {
  stoppedTime: number;
  deltaFromTarget: number;
  timestamp: string;
  deviceType: string;
  userId: string;
};

type UserProfile = {
  id: string;
  displayName?: string;
  personalBestAccuracy?: number;
  totalAttempts?: number;
  lastPlayedTime?: string;
};

type LeaderboardEntry = {
  userId: string;
  userName: string;
  stoppedTime: number;
  deltaFromTarget: number;
  timestamp: string;
};

const TARGET_TIME = 17.0;

// Fallback message generator if AI fails
function getFallbackMessage(delta: number): GenerateRageMessageOutput {
  const abs = Math.abs(delta);
  let message = 'NOT EVEN CLOSE';
  if (abs < 0.02) message = 'PERFECT';
  else if (abs < 0.1) message = 'SO CLOSE';
  else if (abs < 0.3) message = delta > 0 ? 'TOO LATE' : 'TOO EARLY';
  else if (abs < 0.6) message = 'ALMOST';

  let socialProofLine = 'Most people struggle with timing.';
  if (message === 'PERFECT') {
    socialProofLine = 'You are in the top 0.01%';
  } else if (abs < 0.5) {
    socialProofLine = `93% fail between ${TARGET_TIME - 0.5}–${
      TARGET_TIME + 0.5
    }`;
  }

  return {
    message,
    secondaryTaunt: '',
    socialProofLine,
  };
}

export default function Home() {
  const [gameState, setGameState] = useState<GameState>('idle');
  const [displayedTime, setDisplayedTime] = useState(0);
  const [result, setResult] = useState<Result>({
    finalTime: 0,
    delta: 0,
    aiResponse: null,
  });
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const { toast } = useToast();

  const [userName, setUserName] = useState('');
  const [showNameInput, setShowNameInput] = useState(false);

  const { auth, firestore } = useFirebase();
  const { user, isUserLoading } = useUser();

  const userProfileRef = useMemoFirebase(
    () => (user ? doc(firestore, 'users', user.uid) : null),
    [firestore, user]
  );
  const { data: userProfile } = useDoc<UserProfile>(userProfileRef);

  const leaderboardQuery = useMemoFirebase(
    () =>
      query(
        collection(firestore, 'leaderboard'),
        orderBy('deltaFromTarget', 'asc'),
        limit(10)
      ),
    [firestore]
  );
  const {
    data: leaderboardScores,
    isLoading: isLeaderboardLoading,
  } = useCollection<LeaderboardEntry>(leaderboardQuery);

  const requestRef = useRef<number>();
  const startTimeRef = useRef<number | null>(null);
  const displayedTimeRef = useRef(0);

  useEffect(() => {
    if (auth && !user && !isUserLoading) {
      initiateAnonymousSignIn(auth);
    }
  }, [auth, user, isUserLoading]);

  useEffect(() => {
    if (userProfile) {
      if (userProfile.displayName) {
        setUserName(userProfile.displayName);
        setShowNameInput(false);
      } else {
        setShowNameInput(true);
      }
    }
  }, [userProfile]);

  const autoStopTimer = useCallback(() => {
    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
    }
    setGameState('stopped');
    setIsAiGenerating(false);

    const finalTime = 18.0;
    const delta = finalTime - TARGET_TIME;

    setResult({
      finalTime,
      delta,
      aiResponse: {
        message: "YOU DIDN'T EVEN TRY",
        secondaryTaunt: 'The timer ran out at 18 seconds.',
        socialProofLine: 'You have to actually click to play.',
      },
    });
  }, []);

  const gameLoop = useCallback(
    (now: number) => {
      if (startTimeRef.current === null) {
        startTimeRef.current = now;
      }
      const elapsed = (now - startTimeRef.current) / 1000;
      if (elapsed >= 18.0) {
        autoStopTimer();
        return;
      }
      setDisplayedTime(elapsed);
      displayedTimeRef.current = elapsed;
      requestRef.current = requestAnimationFrame(gameLoop);
    },
    [autoStopTimer]
  );

  const startGame = useCallback(() => {
    setDisplayedTime(0);
    displayedTimeRef.current = 0;
    setResult({ finalTime: 0, delta: 0, aiResponse: null });
    setGameState('playing');
    startTimeRef.current = null;
    requestRef.current = requestAnimationFrame(gameLoop);
  }, [gameLoop]);

  useEffect(() => {
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  const handleNameSubmit = useCallback(async () => {
    if (!user || !userName.trim()) {
      toast({
        variant: 'destructive',
        title: 'Invalid Name',
        description: 'Please enter a valid name.',
      });
      return;
    }
    const userDocRef = doc(firestore, 'users', user.uid);
    setDocumentNonBlocking(
      userDocRef,
      { displayName: userName.trim() },
      { merge: true }
    );
    setShowNameInput(false);
    toast({
      title: 'Name Saved!',
      description: 'Your name will now appear on the leaderboard.',
    });
  }, [user, userName, firestore, toast]);

  const stopTimer = useCallback(async () => {
    if (gameState !== 'playing' || !user) return;

    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
    }
    setGameState('stopped');

    const finalTime = displayedTimeRef.current;
    const delta = finalTime - TARGET_TIME;
    const absDelta = Math.abs(delta);

    // --- Firestore Logic ---
    const oldPersonalBest = userProfile?.personalBestAccuracy ?? Infinity;
    const isNewPersonalBest = absDelta < oldPersonalBest;

    const newAttempt: Omit<Attempt, 'id'> = {
      userId: user.uid,
      stoppedTime: finalTime,
      deltaFromTarget: absDelta,
      timestamp: new Date().toISOString(),
      deviceType: 'desktop', // This could be dynamic
    };

    const attemptsColRef = collection(
      firestore,
      'users',
      user.uid,
      'attempts'
    );
    addDocumentNonBlocking(attemptsColRef, newAttempt);

    const userDocRef = doc(firestore, 'users', user.uid);
    const newTotalAttempts = (userProfile?.totalAttempts || 0) + 1;
    const newPersonalBestValue = Math.min(
      userProfile?.personalBestAccuracy ?? Infinity,
      absDelta
    );

    const userUpdateData = {
      id: user.uid, // Required by security rules on create
      totalAttempts: newTotalAttempts,
      lastPlayedTime: new Date().toISOString(),
      personalBestAccuracy: newPersonalBestValue,
    };
    setDocumentNonBlocking(userDocRef, userUpdateData, { merge: true });

    // Add/Update score on global leaderboard
    const currentUserName = userProfile?.displayName || userName || 'Anonymous';
    if (currentUserName !== 'Anonymous' && isNewPersonalBest) {
      const leaderboardDocRef = doc(firestore, 'leaderboard', user.uid);
      const newLeaderboardEntry: LeaderboardEntry = {
        userId: user.uid,
        userName: currentUserName,
        stoppedTime: finalTime,
        deltaFromTarget: absDelta,
        timestamp: new Date().toISOString(),
      };
      setDocumentNonBlocking(leaderboardDocRef, newLeaderboardEntry, { merge: true });
    }
    // --- End Firestore Logic ---

    setResult({ finalTime, delta, aiResponse: null });
    setIsAiGenerating(true);

    try {
      const aiResponse = await generateRageMessage({
        delta: parseFloat(delta.toFixed(4)),
      });
      setResult({ finalTime, delta, aiResponse });
    } catch (e) {
      console.error('AI generation failed', e);
      toast({
        variant: 'destructive',
        title: 'Connection Error',
        description: "Couldn't generate a custom message. Using a fallback.",
      });
      const fallbackResponse = getFallbackMessage(delta);
      setResult({ finalTime, delta, aiResponse: fallbackResponse });
    } finally {
      setIsAiGenerating(false);
    }
  }, [gameState, toast, user, firestore, userProfile, userName]);

  const isPerfect = result.aiResponse?.message === 'PERFECT';

  const renderResultText = () => {
    if (!result.aiResponse) return null;

    if (isPerfect) {
      return (
        <p className="font-headline text-3xl uppercase tracking-[0.2em] text-purple-300">
          PERFECT
        </p>
      );
    }
    return (
      <div className="flex flex-col items-center gap-1">
        <p className="font-headline text-xl uppercase tracking-widest text-white/80 sm:text-2xl">
          {result.delta > 0 ? '+' : ''}
          {result.delta.toFixed(2)}{' '}
          <span className="ml-2">{result.aiResponse.message}</span>
        </p>
        <p className="font-headline text-sm text-white/50 sm:text-base">
          {result.aiResponse.secondaryTaunt
            ? result.aiResponse.secondaryTaunt
            : result.aiResponse.socialProofLine}
        </p>
      </div>
    );
  };

  return (
    <>
      <main
        className={cn(
          'flex min-h-dvh w-full flex-col items-center justify-center overflow-auto bg-gradient-to-br from-[#05040b] to-[#0b0614] p-4 pb-20 text-white selection:bg-purple-500/30',
          gameState === 'playing' && 'cursor-pointer'
        )}
        onClick={gameState === 'playing' ? stopTimer : undefined}
      >
        {gameState === 'idle' && (
          <div className="flex flex-col items-center justify-center text-center animate-in fade-in-0 duration-500">
            <h1 className="font-headline text-3xl sm:text-4xl uppercase tracking-[0.3em] text-white/80">
              Everyone Fails at {TARGET_TIME}
            </h1>
            <p className="mt-4 max-w-md text-white/60">
              Can you stop the timer at exactly {TARGET_TIME.toFixed(2)} seconds?
            </p>
            <div className="h-12" />
            <Button
              onClick={startGame}
              size="lg"
              className="h-12 sm:h-14 rounded-full px-10 sm:px-12 font-headline text-xl sm:text-2xl uppercase tracking-widest transition-transform hover:scale-105"
              disabled={isUserLoading}
            >
              {isUserLoading ? 'Connecting...' : 'Start Game'}
            </Button>
          </div>
        )}

        {gameState === 'playing' && (
          <div className="flex flex-col items-center justify-center animate-in fade-in-0 duration-500">
            <p className="font-headline text-lg uppercase tracking-[0.3em] text-white/60">
              Click anywhere to stop
            </p>
            <div className="h-8" />
            <p className="font-body text-[clamp(6rem,25vw,9rem)] font-bold leading-none text-white drop-shadow-[0_0_15px_hsla(var(--primary),0.5)]">
              {displayedTime > 0 ? displayedTime.toFixed(2) : '0.00'}
            </p>
          </div>
        )}

        {gameState === 'stopped' && (
          <div className="flex w-full flex-col items-center justify-center text-center animate-in fade-in-0 duration-500">
            <p
              className={cn(
                'font-body text-[clamp(6rem,25vw,9rem)] font-bold leading-none text-white transition-all duration-500',
                isPerfect
                  ? 'drop-shadow-[0_0_25px_hsl(var(--primary))] text-purple-300'
                  : 'drop-shadow-[0_0_15px_hsla(var(--primary),0.5)]'
              )}
            >
              {result.finalTime.toFixed(2)}
            </p>
            <div className="h-4" />
            <div className="flex min-h-[4rem] flex-col items-center justify-center animate-in fade-in-0 delay-300 duration-500">
              {isAiGenerating ? (
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/20 border-t-purple-400"></div>
              ) : (
                result.aiResponse && renderResultText()
              )}
            </div>

            {!isAiGenerating && (
              <div className="mt-8 flex w-full max-w-sm flex-col items-center gap-8 animate-in fade-in-0 delay-500 duration-500">
                <Button
                  onClick={startGame}
                  size="lg"
                  className="h-12 sm:h-14 rounded-full px-10 sm:px-12 font-headline text-xl sm:text-2xl uppercase tracking-widest transition-transform hover:scale-105"
                >
                  Try Again
                </Button>

                {showNameInput && (
                  <div className="flex w-full flex-col items-center gap-2">
                    <p className="font-headline text-base sm:text-lg uppercase tracking-widest text-white/80">
                      Add your name to the leaderboard!
                    </p>
                    <div className="flex w-full gap-2">
                      <Input
                        value={userName}
                        onChange={(e) => setUserName(e.target.value)}
                        placeholder="Enter your name"
                        className="text-center"
                        onKeyDown={(e) =>
                          e.key === 'Enter' && handleNameSubmit()
                        }
                      />
                      <Button onClick={handleNameSubmit}>Save</Button>
                    </div>
                  </div>
                )}

                <div className="w-full">
                  <h2 className="font-headline text-lg sm:text-xl uppercase tracking-[0.3em] text-white/60">
                    Top 10 Players
                  </h2>
                  <div className="h-4" />
                  {isLeaderboardLoading && (
                    <div className="space-y-2">
                      <Skeleton className="h-[58px] w-full" />
                      <Skeleton className="h-[58px] w-full" />
                      <Skeleton className="h-[58px] w-full" />
                    </div>
                  )}
                  {!isLeaderboardLoading &&
                    (leaderboardScores && leaderboardScores.length > 0 ? (
                      <>
                        <ol className="space-y-2 text-white/80">
                          {leaderboardScores.map((score, index) => (
                            <li
                              key={score.id}
                              className={cn(
                                'flex items-center justify-between rounded-md bg-white/5 p-3 font-body',
                                user?.uid === score.userId &&
                                  'ring-2 ring-primary'
                              )}
                            >
                              <span className="w-8 font-bold text-white/60 flex items-center gap-2">
                                {index === 0 && (
                                  <Crown className="w-4 h-4 text-yellow-400" />
                                )}
                                {index > 0 && `#${index + 1}`}
                              </span>
                              <span className="truncate font-medium">
                                {score.userName}
                              </span>
                              <span className="w-20 sm:w-24 text-right font-mono text-sm text-white/50">
                                +{score.deltaFromTarget.toFixed(3)}s
                              </span>
                            </li>
                          ))}
                        </ol>
                        <p className="mt-4 text-center font-headline text-sm uppercase tracking-widest text-white/60">
                          Beat {leaderboardScores[0].userName} and be the next
                          top one
                        </p>
                      </>
                    ) : (
                      <p className="text-white/50">
                        The leaderboard is empty. Be the first!
                      </p>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
      <footer className="fixed bottom-0 left-0 right-0 z-20 h-14 border-t border-white/10 bg-background/50 backdrop-blur-sm">
        <div className="mx-auto flex h-full max-w-5xl items-center justify-between px-4 text-sm text-white/50">
          <p>
            Made with ❤️ by{' '}
            <span
              className="font-medium text-white/80"
            >
              DarkHax
            </span>
          </p>
          <a
            href="https://www.buymeacoffee.com/darkhax"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-md px-3 py-1.5 hover:bg-white/10 hover:text-white"
          >
            <Coffee size={16} />
            <span className="hidden sm:inline">Buy me a coffee</span>
          </a>
        </div>
      </footer>
    </>
  );
}
