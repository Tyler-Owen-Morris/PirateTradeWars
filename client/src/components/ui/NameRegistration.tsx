import { useState } from 'react';
import { useGameState } from '@/lib/stores/useGameState';
import { useSocket } from '@/lib/stores/useSocket';
import { ParchmentPanel, PirateButton, SeaChartBackdrop, SectionTitle, TitleLockup } from '@/components/ui/pirate';
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
    <div className="fixed inset-0">
      <SeaChartBackdrop />
      <div className="absolute inset-0 overflow-y-auto flex flex-col items-center justify-center p-4 gap-6">
        <TitleLockup />
        <ParchmentPanel torn className="w-full max-w-md px-6 py-7">
          <SectionTitle className="text-3xl mb-4">Enter Your Pirate Name</SectionTitle>

          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
              <input
                placeholder="Captain..."
                aria-label="Pirate name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setIsNameValid(false);
                }}
                className="ptw-input"
                required
                minLength={3}
                maxLength={20}
                autoFocus
              />

              {errorMessage && (
                <div role="alert" className="ptw-alert">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <PirateButton
                type="submit"
                block
                disabled={isChecking}
              >
                {isChecking ? 'Checking...' : (isNameValid ? 'Start Adventure' : 'Check Name')}
              </PirateButton>
            </div>
          </form>

          <div className="mt-6 text-center italic text-ptw-ink-soft">
            <p>Sail the high seas, trade at ports, and battle other pirates!</p>
            <p className="mt-2">Your goal: Collect the most gold before your ship sinks.</p>
          </div>
        </ParchmentPanel>
      </div>
    </div>
  );
}
