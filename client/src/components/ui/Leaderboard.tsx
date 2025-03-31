import { useEffect, useState } from 'react';
import { useGameState } from '@/lib/stores/useGameState';
import { LeaderboardEntry } from '@/types';
import { apiRequest } from '@/lib/queryClient';
import { Trophy, Coins, Calendar } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './card';

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
  
  if (compact) {
    return (
      <div className="w-full">
        <h3 className="text-center font-bold mb-2">Top Pirates</h3>
        {loading ? (
          <div className="text-center py-4">Loading scores...</div>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2 text-xs">#</th>
                  <th className="text-left p-2 text-xs">Pirate</th>
                  <th className="text-right p-2 text-xs">Gold</th>
                </tr>
              </thead>
              <tbody>
                {entries.slice(0, 5).map((entry, index) => (
                  <tr key={entry.id} className={index % 2 === 0 ? "bg-transparent" : "bg-muted/20"}>
                    <td className="p-2 text-sm">{index + 1}</td>
                    <td className="p-2 text-sm">{entry.playerName}</td>
                    <td className="p-2 text-sm text-right">{entry.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }
  
  return (
    <div className="fixed inset-0 flex items-center justify-center z-50">
      <Card className="w-full max-w-2xl mx-4 bg-black/90 text-white border-gray-700">
        <CardHeader>
          <CardTitle className="flex items-center justify-center">
            <Trophy className="h-6 w-6 text-yellow-500 mr-2" />
            Pirate Leaderboard
          </CardTitle>
        </CardHeader>
        
        <CardContent>
          {loading ? (
            <div className="text-center py-8">Loading the leaderboard...</div>
          ) : error ? (
            <div className="text-center text-red-500 py-8">{error}</div>
          ) : (
            <div className="overflow-hidden rounded-md border border-gray-700">
              <table className="w-full">
                <thead className="bg-gray-800">
                  <tr>
                    <th className="text-left p-3">#</th>
                    <th className="text-left p-3">Pirate Name</th>
                    <th className="text-right p-3">
                      <div className="flex items-center justify-end">
                        <Coins className="h-4 w-4 mr-1" />
                        Gold
                      </div>
                    </th>
                    <th className="text-right p-3">
                      <div className="flex items-center justify-end">
                        <Calendar className="h-4 w-4 mr-1" />
                        Date
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, index) => (
                    <tr 
                      key={entry.id} 
                      className={index % 2 === 0 ? "bg-transparent" : "bg-gray-800/50"}
                    >
                      <td className="p-3">
                        {index === 0 ? (
                          <span className="inline-flex items-center justify-center w-6 h-6 bg-yellow-500 text-black font-bold rounded-full">1</span>
                        ) : index === 1 ? (
                          <span className="inline-flex items-center justify-center w-6 h-6 bg-gray-300 text-black font-bold rounded-full">2</span>
                        ) : index === 2 ? (
                          <span className="inline-flex items-center justify-center w-6 h-6 bg-amber-700 text-white font-bold rounded-full">3</span>
                        ) : (
                          index + 1
                        )}
                      </td>
                      <td className="p-3 font-medium">{entry.playerName}</td>
                      <td className="p-3 text-right font-bold text-yellow-400">{entry.score.toLocaleString()}</td>
                      <td className="p-3 text-right text-gray-400">{formatDate(entry.achievedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          
          <div className="text-center text-sm mt-6 text-gray-400">
            Press Tab to view this anytime during the game
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
