import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card';
import { Button } from './button';
import { useGameState } from '@/lib/stores/useGameState';
import { useSocket } from '@/lib/stores/useSocket';
import { Skull, Trophy, Coins, RefreshCw } from 'lucide-react';
import Leaderboard from './Leaderboard';

interface GameOverProps {
  score: number;
}

export default function GameOver({ score }: GameOverProps) {
  const { restartGame, gameState } = useGameState();
  const { disconnect } = useSocket();
  const [playerRank, setPlayerRank] = useState<number | null>(null);
  
  // Automatically show leaderboard in game over screen
  useEffect(() => {
    // Add a short delay to ensure the leaderboard in state is updated with recent entry
    const timer = setTimeout(() => {
      if (gameState.leaderboard && gameState.leaderboard.length > 0) {
        // Find the player's position on the leaderboard
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
    // Disconnect current socket
    disconnect();
    
    // Clear game state and restart
    restartGame();
  };
  
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-gray-800/50 z-50">
      <Card className="w-full max-w-md mx-4 relative overflow-hidden bg-gray-900/90">
        <div className="absolute inset-0 bg-red-800/20 animate-pulse pointer-events-none" />

        <CardHeader className="relative">
          <div className="flex justify-center mb-4">
            <Skull className="h-16 w-16 text-red-500" />
          </div>
          <CardTitle className="text-center text-2xl text-white">Your Ship Has Sunk!</CardTitle>
          <CardDescription className="text-center text-white">
            Your pirate adventure has come to an end... for now.
          </CardDescription>
        </CardHeader>

        <CardContent className="relative">
          <div className="flex flex-col items-center space-y-4">
            <div className="flex items-center justify-center space-x-2">
              <Trophy className="h-6 w-6 text-yellow-500" />
              <span className="text-xl text-white font-bold">Final Score</span>
            </div>

            <div className="flex items-center justify-center">
              <Coins className="h-8 w-8 text-yellow-400 mr-2" />
              <span className="text-3xl text-yellow-400 font-bold">{score}</span>
              <span className="ml-2 text-lg text-yellow-400">gold</span>
            </div>

            {playerRank && (
              <div className="text-center mt-2 text-amber-400">
                Your rank: #{playerRank} on the leaderboard!
              </div>
            )}

            <div className="w-full mt-4 border border-gray-700 rounded-md overflow-hidden">
              <div className="bg-gray-700 p-2 text-center text-white font-bold">
                <Trophy className="h-5 w-5 text-yellow-500 inline-block mr-2" />
                Pirate Leaderboard
              </div>
              <div className="p-2 max-h-[200px] overflow-y-auto">
                {gameState.leaderboard && gameState.leaderboard.length > 0 ? (
                  <table className="w-full">
                    <thead className="bg-gray-700 text-xs">
                      <tr>
                        <th className="p-2 text-white text-left">#</th>
                        <th className="p-2 text-white text-left">Pirate</th>
                        <th className="p-2 text-white text-right">Gold</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gameState.leaderboard.map((entry, index) => (
                        <tr 
                          key={entry.id}
                          className={`border-t border-gray-700 ${
                            playerRank !== null && index === playerRank - 1 
                              ? 'bg-amber-800/40' 
                              : ''
                          }`}
                        >
                          <td className="text-white p-2">{index + 1}</td>
                          <td className="text-white p-2">{entry.playerName}</td>
                          <td className="text-white p-2 text-right">{entry.score}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-center py-4">Loading leaderboard...</div>
                )}
              </div>
            </div>
          </div>
        </CardContent>

        <CardFooter className="flex justify-center relative pt-4">
          <Button 
            className="w-full bg-amber-600 hover:bg-amber-700 text-black"
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
