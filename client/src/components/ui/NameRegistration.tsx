import { useState } from 'react';
import { useGameState } from '@/lib/stores/useGameState';
import { useSocket } from '@/lib/stores/useSocket';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';

export default function NameRegistration() {
  const [name, setName] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [isNameValid, setIsNameValid] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  
  const { registerPlayer } = useGameState();
  const socket = useSocket();
  
  // Connect to WebSocket when component mounts
  useState(() => {
    socket.connect();
  });
  
  // Check if name is available
  const checkName = async () => {
    if (name.trim().length < 3) {
      setErrorMessage('Name must be at least 3 characters long');
      setIsNameValid(false);
      return;
    }
    
    setIsChecking(true);
    setErrorMessage('');
    
    try {
      const response = await apiRequest('GET', `/api/check-player-name?name=${encodeURIComponent(name)}`, undefined);
      const data = await response.json();
      
      if (data.available) {
        setIsNameValid(true);
      } else {
        setErrorMessage('This name is already taken. Please choose another.');
        setIsNameValid(false);
      }
    } catch (error) {
      console.error('Error checking name:', error);
      setErrorMessage('Error checking name availability. Please try again.');
      setIsNameValid(false);
    } finally {
      setIsChecking(false);
    }
  };
  
  // Handle name submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isNameValid) {
      checkName();
      return;
    }
    
    // Register player name
    registerPlayer(name);
  };
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-blue-900 to-blue-700 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Pirate Odyssey</CardTitle>
        </CardHeader>
        
        <CardContent>
          <h2 className="text-xl font-semibold mb-4">Enter Your Pirate Name</h2>
          
          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
              <Input
                placeholder="Captain..."
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setIsNameValid(false);
                }}
                className="w-full"
                required
                minLength={3}
                maxLength={20}
                autoFocus
              />
              
              {errorMessage && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              )}
              
              <Button 
                type="submit" 
                className="w-full" 
                disabled={isChecking}
              >
                {isChecking ? 'Checking...' : (isNameValid ? 'Start Adventure' : 'Check Name')}
              </Button>
            </div>
          </form>
          
          <div className="mt-6 text-sm text-center text-gray-500">
            <p>Sail the high seas, trade at ports, and battle other pirates!</p>
            <p className="mt-2">Your goal: Collect the most gold before your ship sinks.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
