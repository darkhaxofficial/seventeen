'use server';

/**
 * @fileOverview This flow generates a customized failure message for the "Everyone Fails at 18" game.
 *
 * - generateRageMessage - A function that generates a failure message based on the time delta.
 * - GenerateRageMessageInput - The input type for the generateRageMessage function.
 * - GenerateRageMessageOutput - The return type for the generateRageMessage function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GenerateRageMessageInputSchema = z.object({
  delta: z.number().describe('The difference between the stopped time and 18 seconds.'),
});
export type GenerateRageMessageInput = z.infer<typeof GenerateRageMessageInputSchema>;

const GenerateRageMessageOutputSchema = z.object({
  message: z.string().describe('The generated failure message.'),
  secondaryTaunt: z.string().optional().describe('An optional secondary taunt message.'),
  socialProofLine: z.string().optional().describe('An optional social proof line.'),
});
export type GenerateRageMessageOutput = z.infer<typeof GenerateRageMessageOutputSchema>;

export async function generateRageMessage(input: GenerateRageMessageInput): Promise<GenerateRageMessageOutput> {
  return generateRageMessageFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateRageMessagePrompt',
  input: {schema: GenerateRageMessageInputSchema},
  output: {schema: GenerateRageMessageOutputSchema},
  prompt: `You are the AI for a timing game called "Everyone Fails at 18". The goal of the game is to stop a timer as close to 18 seconds as possible. The player has failed to stop the timer at exactly 18 seconds.

  Your job is to generate a humorous and psychologically provoking failure message to encourage the player to play again. You must always provide a message. You may optionally provide a secondary taunt message and/or a social proof line. The secondary taunt should be one line and should not be too harsh. The social proof line should be a statement about how other players typically perform.

  Here are some example secondary taunts:
  - Everyone thinks they can do this.
  - You trusted the timer.
  - Your brain lied to you.
  - Again. You’ll do better.
  - Almost counts for nothing.

  Here are some example social proof lines:
  - Most people click too late.
  - Most people click too early.
  - 93% fail between 17.5–18.5.

The delta (the difference between the stopped time and 18 seconds) is: {{delta}}
`,
});

const generateRageMessageFlow = ai.defineFlow(
  {
    name: 'generateRageMessageFlow',
    inputSchema: GenerateRageMessageInputSchema,
    outputSchema: GenerateRageMessageOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
