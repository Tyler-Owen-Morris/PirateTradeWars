import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card';
import { Button } from './button';
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
    <div className="fixed inset-0 flex items-center justify-center bg-gray-800/50 z-50">
      <Card className="w-full max-w-[90vw] sm:max-w-lg mx-4 relative overflow-hidden bg-gradient-to-br from-amber-900/80 to-amber-800/80 border-amber-500/50 shadow-lg transition-all duration-300">
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-amber-600 to-amber-400 rounded-t-lg" />

        <CardHeader className="relative pt-8 pb-4">
          <div className="flex justify-center mb-4">
            <Skull className="h-16 w-16 text-red-400" />
          </div>
          <CardTitle className="text-center text-xl sm:text-2xl text-amber-400 font-bold">{headerText}</CardTitle>
          <CardDescription className="text-center text-amber-100 text-sm sm:text-base italic">
            {subHeadingText}
          </CardDescription>
        </CardHeader>

        <CardContent className="relative px-6 py-4">
          <div className="flex flex-col items-center space-y-4">
            <div className="flex items-center justify-center space-x-2">
              <Trophy className="h-6 w-6 text-yellow-500" />
              <span className="text-lg sm:text-xl text-amber-200 font-bold">Final Score</span>
            </div>
            <div className="flex items-center justify-center">
              <Coins className="h-8 w-8 text-yellow-400 mr-2" />
              <span className="text-2xl sm:text-3xl text-yellow-400 font-bold">{score}</span>
              <span className="ml-2 text-lg text-yellow-400">gold</span>
            </div>
            {isNegativeScore ? (
              <p className="text-red-400 text-sm text-center">
                Your debt prevented your score from being recorded on the leaderboard.
              </p>
            ) : playerRank ? (
              <div className="text-center text-amber-400 text-sm sm:text-base">
                Your rank: #{playerRank} on the leaderboard!
              </div>
            ) : null}
            <div className="w-full mt-4 border border-amber-500/50 rounded-md overflow-hidden">
              <div className="bg-amber-900/70 p-2 text-center text-amber-200 font-bold">
                <Trophy className="h-5 w-5 text-yellow-500 inline-block mr-2" />
                Pirate Leaderboard
              </div>
              <div className="p-2 max-h-[200px] overflow-y-auto">
                {gameState.leaderboard && gameState.leaderboard.length > 0 ? (
                  <table className="w-full text-amber-100 text-sm">
                    <thead className="bg-amber-900/50 text-xs">
                      <tr>
                        <th className="p-2 text-left">#</th>
                        <th className="p-2 text-left">Pirate</th>
                        <th className="p-2 text-right">Gold</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gameState.leaderboard.map((entry, index) => (
                        <tr
                          key={entry.id}
                          className={`border-t border-amber-500/20 ${playerRank !== null && index === playerRank - 1 ? 'bg-amber-800/40' : ''
                            }`}
                        >
                          <td className="p-2">{index + 1}</td>
                          <td className="p-2">{entry.playerName}</td>
                          <td className="p-2 text-right">{entry.score}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-center py-4 text-amber-100">Loading leaderboard...</div>
                )}
              </div>
            </div>
          </div>
        </CardContent>

        <CardFooter className="flex justify-center relative pt-4 pb-6">
          <Button
            className="w-full sm:w-auto bg-amber-600 hover:bg-amber-700 text-white font-semibold py-2 px-4 rounded-md transition-all duration-200"
            size="lg"
            onClick={handleRestart}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Start Again
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}