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
  const { restartGame } = useGameState();
  const { disconnect } = useSocket();
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  
  // Load leaderboard when game over screen appears
  useEffect(() => {
    useGameState.getState().loadLeaderboard();
  }, []);
  
  // Handle restart
  const handleRestart = () => {
    // Disconnect current socket
    disconnect();
    
    // Clear game state and restart
    restartGame();
  };
  
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/70 z-50">
      <Card className="w-full max-w-md mx-4 relative overflow-hidden">
        {/* Animated background effect */}
        <div className="absolute inset-0 bg-red-900/30 animate-pulse pointer-events-none" />
        
        <CardHeader className="relative">
          <div className="flex justify-center mb-4">
            <Skull className="h-16 w-16 text-red-500" />
          </div>
          <CardTitle className="text-center text-2xl">Your Ship Has Sunk!</CardTitle>
          <CardDescription className="text-center">
            Your pirate adventure has come to an end... for now.
          </CardDescription>
        </CardHeader>
        
        <CardContent className="relative">
          <div className="flex flex-col items-center space-y-4">
            <div className="flex items-center justify-center space-x-2">
              <Trophy className="h-6 w-6 text-yellow-500" />
              <span className="text-xl font-bold">Final Score</span>
            </div>
            
            <div className="flex items-center justify-center">
              <Coins className="h-8 w-8 text-yellow-400 mr-2" />
              <span className="text-3xl font-bold">{score}</span>
              <span className="ml-2 text-lg">gold</span>
            </div>
            
            <Button 
              variant="outline" 
              className="mt-4"
              onClick={() => setShowLeaderboard(prev => !prev)}
            >
              {showLeaderboard ? "Hide Leaderboard" : "View Leaderboard"}
            </Button>
            
            {showLeaderboard && (
              <div className="w-full mt-4">
                <Leaderboard compact={true} />
              </div>
            )}
          </div>
        </CardContent>
        
        <CardFooter className="flex justify-center relative">
          <Button 
            className="w-full"
            size="lg"
            onClick={handleRestart}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Try Again
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
