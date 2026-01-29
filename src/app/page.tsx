'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  generateRageMessage,
  type GenerateRageMessageOutput,
} from '@/ai/flows/generate-rage-message';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';

type GameState = 'idle' | 'playing' | 'stopped';

type Result = {
  finalTime: number;
  delta: number;
  aiResponse: GenerateRageMessageOutput | null;
};

type Score = {
  finalTime: number;
  delta: number;
};

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
    socialProofLine = '93% fail between 16.5–17.5';
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
  const [scores, setScores] = useState<Score[]>([]);
  const { toast } = useToast();

  const requestRef = useRef<number>();
  const startTimeRef = useRef<number | null>(null);

  // Load scores from localStorage on mount
  useEffect(() => {
    try {
      const savedScores = localStorage.getItem('seventeen-leaderboard');
      if (savedScores) {
        setScores(JSON.parse(savedScores));
      }
    } catch (e) {
      console.error('Failed to load scores from localStorage', e);
    }
  }, []);

  const manipulateTime = useCallback((t: number): number => {
    let speed = 1;
    if (t > 10) {
      speed += (t - 10) * 0.015;
    }
    const jitter = Math.random() < 0.02 ? Math.random() * 0.03 : 0;
    const skip = Math.random() < 0.005 ? 0.05 : 0;
    return t * speed + jitter + skip;
  }, []);

  const gameLoop = useCallback(
    (now: number) => {
      if (startTimeRef.current === null) {
        startTimeRef.current = now;
      }
      const elapsed = (now - startTimeRef.current) / 1000;
      const manipulated = manipulateTime(elapsed);
      setDisplayedTime(manipulated);
      requestRef.current = requestAnimationFrame(gameLoop);
    },
    [manipulateTime]
  );

  const startGame = useCallback(() => {
    setDisplayedTime(0);
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

  const stopTimer = useCallback(async () => {
    if (gameState !== 'playing') return;

    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
    }
    setGameState('stopped');

    const finalTime = displayedTime;
    const delta = finalTime - 17;

    // Leaderboard logic
    setScores(prevScores => {
      const newScore = { finalTime, delta };
      const updatedScores = [...prevScores, newScore]
        .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))
        .slice(0, 5); // Keep top 5

      try {
        localStorage.setItem(
          'seventeen-leaderboard',
          JSON.stringify(updatedScores)
        );
      } catch (error) {
        console.error('Failed to save scores to localStorage', error);
        toast({
          variant: 'destructive',
          title: 'Leaderboard Error',
          description: 'Could not save your score.',
        });
      }
      return updatedScores;
    });

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
  }, [gameState, displayedTime, toast]);

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
      <p className="font-headline text-2xl uppercase tracking-widest text-white/80">
        {result.delta > 0 ? '+' : ''}
        {result.delta.toFixed(2)}{' '}
        <span className="ml-2">{result.aiResponse.message}</span>
      </p>
    );
  };

  return (
    <main
      className={cn(
        'flex min-h-dvh w-full flex-col items-center justify-center overflow-auto bg-gradient-to-br from-[#05040b] to-[#0b0614] py-8 text-white selection:bg-purple-500/30',
        gameState === 'playing' && 'cursor-pointer'
      )}
      onClick={gameState === 'playing' ? stopTimer : undefined}
    >
      {gameState === 'idle' && (
        <div className="flex flex-col items-center justify-center p-4 text-center animate-in fade-in-0 duration-500">
          <h1 className="font-headline text-4xl uppercase tracking-[0.3em] text-white/80">
            Everyone Fails at 17
          </h1>
          <p className="mt-4 max-w-md text-white/60">
            Can you stop the timer at exactly 17.00 seconds? The timer might not
            be as trustworthy as you think.
          </p>
          <div className="h-12" />
          <Button
            onClick={startGame}
            size="lg"
            className="h-14 rounded-full px-12 font-headline text-2xl uppercase tracking-widest transition-transform hover:scale-105"
          >
            Start Game
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
        <div className="flex flex-col items-center justify-center px-4 text-center animate-in fade-in-0 duration-500">
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
          <div className="flex min-h-[3rem] flex-col items-center justify-center animate-in fade-in-0 delay-300 duration-500">
            {isAiGenerating ? (
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/20 border-t-purple-400"></div>
            ) : (
              result.aiResponse && (
                <div className="flex flex-col items-center justify-center">
                  {renderResultText()}
                  <div className="h-4" />
                  <p className="font-headline text-base text-white/50 sm:text-lg">
                    {result.aiResponse.secondaryTaunt
                      ? result.aiResponse.secondaryTaunt
                      : result.aiResponse.socialProofLine}
                  </p>
                </div>
              )
            )}
          </div>

          {!isAiGenerating && (
            <div className="mt-8 flex w-full max-w-sm flex-col items-center gap-8 animate-in fade-in-0 delay-500 duration-500">
              <Button
                onClick={startGame}
                size="lg"
                className="h-14 rounded-full px-12 font-headline text-2xl uppercase tracking-widest transition-transform hover:scale-105"
              >
                Try Again
              </Button>

              <div className="w-full">
                <h2 className="font-headline text-xl uppercase tracking-[0.3em] text-white/60">
                  Leaderboard
                </h2>
                <div className="h-4" />
                {scores.length > 0 ? (
                  <ol className="space-y-2 text-white/80">
                    {scores.map((score, index) => (
                      <li
                        key={index}
                        className="flex items-center justify-between rounded-md bg-white/5 p-3 font-body"
                      >
                        <span className="w-8 font-bold text-white/60">
                          #{index + 1}
                        </span>
                        <span className="text-lg font-bold">
                          {score.finalTime.toFixed(2)}s
                        </span>
                        <span className="w-20 text-right text-sm text-white/50">
                          {score.delta > 0 ? '+' : ''}
                          {score.delta.toFixed(3)}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-white/50">No scores yet. Be the first!</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
