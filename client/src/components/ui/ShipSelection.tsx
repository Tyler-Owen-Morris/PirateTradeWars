import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card';
import { Button } from './button';
import { useShip } from '@/lib/stores/useShip';
import { useGameState } from '@/lib/stores/useGameState';
import { useSocket } from '@/lib/stores/useSocket';
import { Alert, AlertDescription } from './alert';
import { AlertCircle } from 'lucide-react';
import { SHIP_TYPES, SHIP_DESCRIPTIONS } from '@/lib/constants';

export default function ShipSelection() {
  const { ships, selectedShip, fetchShips, selectShip, error: shipError } = useShip();
  const { startGame } = useGameState();
  const { register, error: socketError } = useSocket();
  const [loading, setLoading] = useState(false);
  const [playerName, setPlayerName] = useState('');
  
  // Get player name from URL parameter (temporary for demo)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const name = params.get('name');
    if (name) {
      setPlayerName(name);
    }
  }, []);
  
  // Fetch available ships when component mounts
  useEffect(() => {
    fetchShips();
  }, [fetchShips]);
  
  // Handle ship selection
  const handleShipSelect = (shipType: string) => {
    selectShip(shipType);
  };
  
  // Start game with selected ship
  const handleStartGame = () => {
    if (!selectedShip || !playerName) return;
    
    setLoading(true);
    
    // Register player with server through WebSocket
    register(playerName, selectedShip.name);
    
    // Start the game
    startGame();
  };
  
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-b from-blue-900 to-blue-700 p-4">
      <Card className="w-full max-w-4xl">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Choose Your Ship</CardTitle>
          <CardDescription className="text-center">
            Select your vessel for your pirate adventure
          </CardDescription>
        </CardHeader>
        
        <CardContent>
          {(shipError || socketError) && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {shipError || socketError}
              </AlertDescription>
            </Alert>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Free Ship: Sloop */}
            <Card 
              className={`cursor-pointer transition-all transform hover:scale-105 ${selectedShip?.name === SHIP_TYPES.SLOOP ? 'border-blue-500 border-2' : ''}`}
              onClick={() => handleShipSelect(SHIP_TYPES.SLOOP)}
            >
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-lg">The Sloop</CardTitle>
                <CardDescription className="text-xs">Free</CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-2">
                <div className="h-40 bg-blue-200 rounded-md flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-blue-800" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 10h18M9 16H6M12 16h-2M12 13l-2-3h9l-2 3M3 17l9-4 9 4M12 7V3" />
                  </svg>
                </div>
                <div className="mt-4 text-xs">
                  <p className="mb-1">{SHIP_DESCRIPTIONS[SHIP_TYPES.SLOOP]}</p>
                  <ul className="space-y-1 mt-2">
                    <li>• Hull: 50 HP</li>
                    <li>• Armor: 0%</li>
                    <li>• Cargo: 20 units</li>
                    <li>• Speed: 5</li>
                    <li>• Cannons: 1 (5 dmg)</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
            
            {/* Paid Ship: Brigantine */}
            <Card 
              className={`cursor-pointer transition-all transform hover:scale-105 ${selectedShip?.name === SHIP_TYPES.BRIGANTINE ? 'border-blue-500 border-2' : ''}`}
              onClick={() => handleShipSelect(SHIP_TYPES.BRIGANTINE)}
            >
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-lg">The Brigantine</CardTitle>
                <CardDescription className="text-xs">Premium Tier 1</CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-2">
                <div className="h-40 bg-green-200 rounded-md flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-20 w-20 text-green-800" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 11h18M9 17H6M12 17h-2M12 14l-2-3h9l-2 3M3 18l9-4 9 4M18 9l-3-6M12 7V3" />
                  </svg>
                </div>
                <div className="mt-4 text-xs">
                  <p className="mb-1">{SHIP_DESCRIPTIONS[SHIP_TYPES.BRIGANTINE]}</p>
                  <ul className="space-y-1 mt-2">
                    <li>• Hull: 150 HP</li>
                    <li>• Armor: 10%</li>
                    <li>• Cargo: 40 units</li>
                    <li>• Speed: 6</li>
                    <li>• Cannons: 2 (8 dmg)</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
            
            {/* Paid Ship: Galleon */}
            <Card 
              className={`cursor-pointer transition-all transform hover:scale-105 ${selectedShip?.name === SHIP_TYPES.GALLEON ? 'border-blue-500 border-2' : ''}`}
              onClick={() => handleShipSelect(SHIP_TYPES.GALLEON)}
            >
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-lg">The Galleon</CardTitle>
                <CardDescription className="text-xs">Premium Tier 2</CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-2">
                <div className="h-40 bg-yellow-200 rounded-md flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24 text-yellow-800" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 11h18M9 17H5M14 17h-4M12 14l-3-3h12l-3 3M3 18l9-4 9 4M18 8l-3-5M12 7V2M6 8l3-5" />
                  </svg>
                </div>
                <div className="mt-4 text-xs">
                  <p className="mb-1">{SHIP_DESCRIPTIONS[SHIP_TYPES.GALLEON]}</p>
                  <ul className="space-y-1 mt-2">
                    <li>• Hull: 300 HP</li>
                    <li>• Armor: 20%</li>
                    <li>• Cargo: 60 units</li>
                    <li>• Speed: 7</li>
                    <li>• Cannons: 3 (12 dmg)</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
            
            {/* Paid Ship: Man-o'-War */}
            <Card 
              className={`cursor-pointer transition-all transform hover:scale-105 ${selectedShip?.name === SHIP_TYPES.MAN_O_WAR ? 'border-blue-500 border-2' : ''}`}
              onClick={() => handleShipSelect(SHIP_TYPES.MAN_O_WAR)}
            >
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-lg">The Man-o'-War</CardTitle>
                <CardDescription className="text-xs">Premium Tier 3</CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-2">
                <div className="h-40 bg-red-200 rounded-md flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-28 w-28 text-red-800" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 11h18M9 18H4M16 18H9M12 15l-4-4h14l-4 4M3 19l9-4 9 4M19 7l-4-4M12 7V1M5 7l4-4" />
                  </svg>
                </div>
                <div className="mt-4 text-xs">
                  <p className="mb-1">{SHIP_DESCRIPTIONS[SHIP_TYPES.MAN_O_WAR]}</p>
                  <ul className="space-y-1 mt-2">
                    <li>• Hull: 500 HP</li>
                    <li>• Armor: 30%</li>
                    <li>• Cargo: 80 units</li>
                    <li>• Speed: 8</li>
                    <li>• Cannons: 4 (15 dmg)</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>
        </CardContent>
        
        <CardFooter className="flex justify-center p-4">
          <Button 
            onClick={handleStartGame} 
            disabled={!selectedShip || loading}
            className="w-1/2"
            size="lg"
          >
            {loading ? "Preparing Ship..." : "Set Sail!"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
