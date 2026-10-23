import { useEffect, useState } from 'react';
import { ParchmentPanel, PirateButton, WaxSeal } from './pirate';
import { useGameState } from '@/lib/stores/useGameState';
import { useSocket } from '@/lib/stores/useSocket';
import { Skull, Trophy, Coins, RefreshCw } from 'lucide-react';

interface GameOverProps {
  score: number;
}

export default function GameOver({ score }: GameOverProps) {
  const { restartGame, gameState } = useGameState();
  const { disconnect } = useSocket();
  const [playerRank, setPlayerRank] = useState<number | null>(null);

  // Automatically show leaderboard in game over screen
  useEffect(() => {
    const timer = setTimeout(() => {
      if (gameState.leaderboard && gameState.leaderboard.length > 0 && score >= 0) {
        const playerEntry = gameState.leaderboard.findIndex(entry =>
          entry.score === score && entry.achievedAt === gameState.leaderboard[gameState.leaderboard.length - 1].achievedAt
        );
        setPlayerRank(playerEntry !== -1 ? playerEntry + 1 : null);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [gameState.leaderboard, score]);

  // Handle restart
  const handleRestart = () => {
    console.log("Restarting game, clearing state and disconnecting...");
    disconnect();
    restartGame();
  };

  // Determine dynamic header and sub-heading for negative scores
  const isNegativeScore = score < 0;
  const headerText = isNegativeScore ? "Your Crew Murdered You!" : "Your Ship Has Sunk!";
  let subHeadingText = isNegativeScore
    ? score > -10
      ? "Just a few coins owed, but enough for your crew to turn on ye!"
      : score > -40
        ? "T’weren’t much gold, but it cost ye your life!"
        : score > -100
          ? "A modest debt, yet the crew’s greed sealed your fate!"
          : "Well, of course they killed ye over that much gold, dummy!"
    : "Your pirate adventure has come to an end... for now.";

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/60 z-50 p-3">
      <ParchmentPanel
        torn
        role="dialog"
        aria-modal="true"
        aria-labelledby="ptw-gameover-title"
        className="w-full max-w-[94vw] sm:max-w-lg max-h-[96vh] overflow-y-auto px-5 sm:px-8 pt-7 pb-7"
      >
        <div className="flex justify-center mb-2">
          <WaxSeal emblem="skull" className="h-20 w-20" />
        </div>
        <h2 id="ptw-gameover-title" className="ptw-title text-[2rem] sm:text-[2.6rem]">{headerText}</h2>
        <p className="text-center text-ptw-ink-soft text-base sm:text-lg italic mt-1">
          {subHeadingText}
        </p>

        <div className="flex flex-col items-center mt-5">
          <div className="ptw-font-label text-lg text-ptw-ink-soft flex items-center gap-2">
            <Trophy className="h-5 w-5 text-ptw-burn" aria-hidden="true" />
            Final Score
          </div>
          <div className="flex items-baseline justify-center mt-1">
            <Coins className="h-7 w-7 text-ptw-burn mr-2 self-center" aria-hidden="true" />
            <span className={`ptw-num text-4xl sm:text-5xl font-bold ${isNegativeScore ? 'text-ptw-bad-ink' : ''}`}>{score}</span>
            <span className="ml-2 ptw-font-label text-xl">gold</span>
          </div>
          {isNegativeScore ? (
            <p className="text-ptw-bad-ink text-sm text-center mt-2 font-bold">
              Your debt prevented your score from being recorded on the leaderboard.
            </p>
          ) : playerRank ? (
            <div className="mt-2 ptw-font-label text-base sm:text-lg">
              Your rank: <span className="ptw-num font-bold">#{playerRank}</span> on the leaderboard!
            </div>
          ) : null}

          <div className="w-full mt-5">
            <h3 className="ptw-title text-2xl mb-1">
              Pirate Leaderboard
            </h3>
            <div className="max-h-[200px] overflow-y-auto">
              {gameState.leaderboard && gameState.leaderboard.length > 0 ? (
                <table className="ptw-ledger ptw-num text-sm sm:text-base">
                  <thead>
                    <tr>
                      <th className="py-1.5 px-2 text-left w-10">#</th>
                      <th className="py-1.5 px-2 text-left">Pirate</th>
                      <th className="py-1.5 px-2 text-right">Gold</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gameState.leaderboard.map((entry, index) => (
                      <tr
                        key={entry.id}
                        className={playerRank !== null && index === playerRank - 1 ? 'is-selected font-bold' : ''}
                      >
                        <td className="py-1.5 px-2">{index + 1}</td>
                        <td className="py-1.5 px-2">{entry.playerName}</td>
                        <td className="py-1.5 px-2 text-right">{entry.score}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-center py-4 italic text-ptw-ink-soft">Loading leaderboard...</div>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-center mt-6">
          <PirateButton
            size="lg"
            className="w-full sm:w-auto"
            onClick={handleRestart}
          >
            <RefreshCw aria-hidden="true" />
            Start Again
          </PirateButton>
        </div>
      </ParchmentPanel>
    </div>
  );
}
