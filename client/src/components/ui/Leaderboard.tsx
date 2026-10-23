import { useEffect, useState } from 'react';
import { useGameState } from '@/lib/stores/useGameState';
import { LeaderboardEntry } from '@/types';
import { apiRequest } from '@/lib/queryClient';
import { Trophy, Coins, Calendar } from 'lucide-react';
import { ParchmentPanel } from './pirate';

interface LeaderboardProps {
  compact?: boolean;
}

export default function Leaderboard({ compact = false }: LeaderboardProps) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Load leaderboard data
  useEffect(() => {
    const loadLeaderboard = async () => {
      try {
        setLoading(true);
        const response = await apiRequest('GET', '/api/leaderboard', undefined);
        const data = await response.json();
        
        if (Array.isArray(data)) {
          setEntries(data);
        } else {
          throw new Error('Invalid leaderboard data');
        }
      } catch (error) {
        console.error('Failed to load leaderboard:', error);
        setError('Failed to load leaderboard data');
        
        // Set some sample data for visualization if API fails
        setEntries([
          { id: 1, playerName: "BlackBeard", score: 12500, achievedAt: new Date().toISOString() },
          { id: 2, playerName: "JackSparrow", score: 10800, achievedAt: new Date().toISOString() },
          { id: 3, playerName: "AnneBolyn", score: 9200, achievedAt: new Date().toISOString() },
          { id: 4, playerName: "CaptainKidd", score: 8500, achievedAt: new Date().toISOString() },
          { id: 5, playerName: "HenryMorgan", score: 7300, achievedAt: new Date().toISOString() }
        ]);
      } finally {
        setLoading(false);
      }
    };
    
    loadLeaderboard();
  }, []);
  
  // Format date in a readable way
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString();
  };
  
  const medal = (index: number) =>
    index === 0 ? 'ptw-medal--gold' : index === 1 ? 'ptw-medal--silver' : index === 2 ? 'ptw-medal--bronze' : null;

  if (compact) {
    return (
      <div className="w-full">
        <h3 className="ptw-title text-xl mb-2">Top Pirates</h3>
        {loading ? (
          <div className="text-center py-4 italic">Loading scores...</div>
        ) : (
          <table className="ptw-ledger ptw-num">
            <thead>
              <tr>
                <th className="text-left p-2 text-xs">#</th>
                <th className="text-left p-2 text-xs">Pirate</th>
                <th className="text-right p-2 text-xs">Gold</th>
              </tr>
            </thead>
            <tbody>
              {entries.slice(0, 5).map((entry, index) => (
                <tr key={entry.id}>
                  <td className="p-2 text-sm">{index + 1}</td>
                  <td className="p-2 text-sm">{entry.playerName}</td>
                  <td className="p-2 text-sm text-right">{entry.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[60] bg-black/40 p-3">
      <ParchmentPanel torn className="w-full max-w-2xl max-h-[92vh] overflow-y-auto px-4 sm:px-8 pt-7 pb-6">
        <h2 className="ptw-title text-3xl sm:text-4xl mb-3">
          <Trophy className="h-6 w-6 sm:h-7 sm:w-7 text-ptw-burn shrink-0" aria-hidden="true" />
          <span>Pirate Leaderboard</span>
        </h2>

        {loading ? (
          <div className="text-center py-8 italic text-ptw-ink-soft">Loading the leaderboard...</div>
        ) : error ? (
          <div className="text-center text-ptw-bad-ink font-bold py-8">{error}</div>
        ) : (
          <table className="ptw-ledger ptw-num text-sm sm:text-base">
            <thead>
              <tr>
                <th className="text-left py-2 px-2 w-12">#</th>
                <th className="text-left py-2 px-2">Pirate Name</th>
                <th className="text-right py-2 px-2">
                  <div className="flex items-center justify-end">
                    <Coins className="h-4 w-4 mr-1" aria-hidden="true" />
                    Gold
                  </div>
                </th>
                <th className="text-right py-2 px-2 hidden sm:table-cell">
                  <div className="flex items-center justify-end">
                    <Calendar className="h-4 w-4 mr-1" aria-hidden="true" />
                    Date
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => (
                <tr key={entry.id}>
                  <td className="py-1.5 px-2">
                    {medal(index) ? (
                      <span className={`ptw-medal ${medal(index)}`}>{index + 1}</span>
                    ) : (
                      <span className="inline-block w-[1.7rem] text-center">{index + 1}</span>
                    )}
                  </td>
                  <td className={`py-1.5 px-2 ${index < 3 ? 'font-bold' : ''}`}>{entry.playerName}</td>
                  <td className="py-1.5 px-2 text-right font-bold">{entry.score.toLocaleString()}</td>
                  <td className="py-1.5 px-2 text-right text-ptw-ink-soft hidden sm:table-cell">{formatDate(entry.achievedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="text-center text-sm mt-5 italic text-ptw-ink-soft">
          Press <kbd className="ptw-kbd">Tab</kbd> to view this anytime during the game
        </div>
      </ParchmentPanel>
    </div>
  );
}
