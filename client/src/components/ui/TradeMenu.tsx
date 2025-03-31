import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from './dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';
import { Button } from './button';
import { Input } from './input';
import { useGameState } from '@/lib/stores/useGameState';
import { useSocket } from '@/lib/stores/useSocket';
import { Good, PortGood, Port, InventoryItem } from '@/types';
import { apiRequest } from '@/lib/queryClient';
import { GOODS } from '@/lib/constants';
import { ShoppingCart, Tag, Package, Coins, X, Info, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from './alert';

export default function TradeMenu() {
  const { gameState, isTrading, setIsTrading, nearPortId } = useGameState();
  const { sendTrade, error: socketError } = useSocket();
  
  const [currentPort, setCurrentPort] = useState<Port | null>(null);
  const [portGoods, setPortGoods] = useState<PortGood[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedGoodId, setSelectedGoodId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [tab, setTab] = useState('buy');
  
  // Get current port and its goods
  useEffect(() => {
    if (nearPortId && isTrading) {
      loadPortData();
      loadInventory();
    }
  }, [nearPortId, isTrading]);
  
  // Load port data
  const loadPortData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Find port in game state
      const port = gameState.ports.find(p => p.id === nearPortId);
      if (port) {
        setCurrentPort(port);
        
        // Load port goods from API
        try {
          const response = await apiRequest('GET', `/api/ports/${port.id}/goods`, undefined);
          const goods = await response.json();
          
          if (Array.isArray(goods)) {
            setPortGoods(goods);
          } else {
            // Fallback to default goods with random prices if API fails
            const fallbackGoods: PortGood[] = GOODS.map(good => ({
              id: good.id,
              portId: port.id,
              goodId: good.id,
              currentPrice: Math.round(good.basePrice * (1 + (Math.random() * 0.4 - 0.2))),
              stock: Math.floor(Math.random() * 50) + 50
            }));
            setPortGoods(fallbackGoods);
          }
        } catch (error) {
          console.error('Failed to load port goods:', error);
          // Create fallback port goods with random prices
          const fallbackGoods: PortGood[] = GOODS.map(good => ({
            id: good.id,
            portId: port.id,
            goodId: good.id,
            currentPrice: Math.round(good.basePrice * (1 + (Math.random() * 0.4 - 0.2))),
            stock: Math.floor(Math.random() * 50) + 50
          }));
          setPortGoods(fallbackGoods);
        }
      }
    } catch (error) {
      console.error('Error loading port data:', error);
      setError('Failed to load port data');
    } finally {
      setLoading(false);
    }
  };
  
  // Load player inventory
  const loadInventory = async () => {
    try {
      setLoading(true);
      
      if (!gameState.player) return;
      
      try {
        const response = await apiRequest('GET', `/api/players/${gameState.player.id}/inventory`, undefined);
        const inventoryItems = await response.json();
        
        if (Array.isArray(inventoryItems)) {
          // Add good details to inventory items
          const itemsWithGoods = inventoryItems.map(item => ({
            ...item,
            good: GOODS.find(g => g.id === item.goodId)
          }));
          
          setInventory(itemsWithGoods);
        } else {
          // Setup empty inventory as fallback
          setInventory([]);
        }
      } catch (error) {
        console.error('Failed to load inventory:', error);
        // Setup empty inventory as fallback
        setInventory([]);
      }
    } catch (error) {
      console.error('Error loading inventory:', error);
    } finally {
      setLoading(false);
    }
  };
  
  // Find good by ID
  const findGood = (id: number): Good | undefined => {
    return GOODS.find(g => g.id === id);
  };
  
  // Get inventory quantity for a good
  const getInventoryQuantity = (goodId: number): number => {
    const item = inventory.find(i => i.goodId === goodId);
    return item ? item.quantity : 0;
  };
  
  // Handle trade
  const handleTrade = () => {
    if (!currentPort || !selectedGoodId || !gameState.player) {
      setError('Unable to complete trade');
      return;
    }
    
    if (quantity <= 0) {
      setError('Quantity must be greater than 0');
      return;
    }
    
    // Get port good
    const portGood = portGoods.find(pg => pg.goodId === selectedGoodId);
    if (!portGood) {
      setError('Good not available at this port');
      return;
    }
    
    // Check if buying or selling
    if (tab === 'buy') {
      // Check if port has enough stock
      if (portGood.stock < quantity) {
        setError(`Not enough stock available. Only ${portGood.stock} units left.`);
        return;
      }
      
      // Check if player has enough gold
      const totalCost = portGood.currentPrice * quantity;
      if (gameState.player.gold < totalCost) {
        setError(`Not enough gold. You need ${totalCost} gold.`);
        return;
      }
      
      // Check if player has enough cargo space
      const spaceNeeded = quantity;
      const spaceAvailable = gameState.player.cargoCapacity - gameState.player.cargoUsed;
      if (spaceNeeded > spaceAvailable) {
        setError(`Not enough cargo space. You only have space for ${spaceAvailable} more units.`);
        return;
      }
    } else {
      // Check if player has enough of the good
      const inventoryQuantity = getInventoryQuantity(selectedGoodId);
      if (inventoryQuantity < quantity) {
        setError(`You don't have enough of this good. You only have ${inventoryQuantity} units.`);
        return;
      }
    }
    
    // Send trade to server
    sendTrade(currentPort.id, tab === 'buy' ? 'buy' : 'sell', selectedGoodId, quantity);
    
    // Reset form
    setSelectedGoodId(null);
    setQuantity(1);
    
    // Reload data
    setTimeout(() => {
      loadPortData();
      loadInventory();
    }, 1000);
  };
  
  // Close dialog
  const handleClose = () => {
    setIsTrading(false);
  };
  
  return (
    <Dialog open={isTrading} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-screen overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center">
            <Tag className="mr-2 h-5 w-5" />
            {currentPort ? currentPort.name : 'Port'} Trading Post
          </DialogTitle>
          <DialogDescription>
            Buy and sell goods to increase your wealth
          </DialogDescription>
        </DialogHeader>
        
        {(error || socketError) && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {error || socketError}
            </AlertDescription>
          </Alert>
        )}
        
        {gameState.player && (
          <div className="flex items-center justify-between mb-4 p-2 bg-muted/20 rounded-md">
            <div className="flex items-center">
              <Coins className="h-5 w-5 mr-2 text-yellow-500" />
              <span className="font-bold">{gameState.player.gold}</span>
              <span className="ml-1 text-sm">gold</span>
            </div>
            <div className="flex items-center">
              <Package className="h-5 w-5 mr-2" />
              <span>{gameState.player.cargoUsed} / {gameState.player.cargoCapacity}</span>
              <span className="ml-1 text-sm">cargo</span>
            </div>
          </div>
        )}
        
        <Tabs defaultValue="buy" value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="buy">Buy Goods</TabsTrigger>
            <TabsTrigger value="sell">Sell Goods</TabsTrigger>
          </TabsList>
          
          <TabsContent value="buy" className="space-y-4">
            <div className="rounded-md border">
              <div className="flex items-center p-2 bg-muted/50 font-medium">
                <div className="w-1/4">Good</div>
                <div className="w-1/4 text-center">Price</div>
                <div className="w-1/4 text-center">Stock</div>
                <div className="w-1/4 text-center">Action</div>
              </div>
              
              {loading ? (
                <div className="p-8 text-center">Loading goods...</div>
              ) : portGoods.length === 0 ? (
                <div className="p-8 text-center">No goods available at this port</div>
              ) : (
                portGoods.map((portGood) => {
                  const good = findGood(portGood.goodId);
                  if (!good) return null;
                  
                  return (
                    <div 
                      key={portGood.id} 
                      className={`flex items-center p-3 border-t ${selectedGoodId === portGood.goodId ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                    >
                      <div className="w-1/4 font-medium">{good.name}</div>
                      <div className="w-1/4 text-center">{portGood.currentPrice} gold</div>
                      <div className="w-1/4 text-center">{portGood.stock} units</div>
                      <div className="w-1/4 text-center">
                        <Button 
                          variant={selectedGoodId === portGood.goodId ? "default" : "outline"}
                          size="sm"
                          onClick={() => setSelectedGoodId(portGood.goodId)}
                          disabled={portGood.stock === 0}
                        >
                          {selectedGoodId === portGood.goodId ? 'Selected' : 'Select'}
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            
            {selectedGoodId && (
              <div className="p-4 rounded-md border">
                <h3 className="font-bold mb-2">Purchase Details</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">Quantity</label>
                    <Input 
                      type="number" 
                      min="1" 
                      max={portGoods.find(pg => pg.goodId === selectedGoodId)?.stock || 1}
                      value={quantity}
                      onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Total Cost</label>
                    <div className="text-xl font-bold">
                      {(portGoods.find(pg => pg.goodId === selectedGoodId)?.currentPrice || 0) * quantity} gold
                    </div>
                  </div>
                </div>
                
                <Button className="w-full mt-4" onClick={handleTrade}>
                  <ShoppingCart className="mr-2 h-4 w-4" />
                  Buy Goods
                </Button>
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="sell" className="space-y-4">
            <div className="rounded-md border">
              <div className="flex items-center p-2 bg-muted/50 font-medium">
                <div className="w-1/4">Good</div>
                <div className="w-1/4 text-center">Price</div>
                <div className="w-1/4 text-center">Owned</div>
                <div className="w-1/4 text-center">Action</div>
              </div>
              
              {loading ? (
                <div className="p-8 text-center">Loading inventory...</div>
              ) : inventory.length === 0 ? (
                <div className="p-8 text-center">Your cargo hold is empty</div>
              ) : (
                inventory
                  .filter(item => item.quantity > 0)
                  .map((item) => {
                    const good = findGood(item.goodId);
                    if (!good) return null;
                    
                    const portGood = portGoods.find(pg => pg.goodId === item.goodId);
                    const price = portGood ? portGood.currentPrice : 0;
                    
                    return (
                      <div 
                        key={item.goodId} 
                        className={`flex items-center p-3 border-t ${selectedGoodId === item.goodId ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                      >
                        <div className="w-1/4 font-medium">{good.name}</div>
                        <div className="w-1/4 text-center">{price} gold</div>
                        <div className="w-1/4 text-center">{item.quantity} units</div>
                        <div className="w-1/4 text-center">
                          <Button 
                            variant={selectedGoodId === item.goodId ? "default" : "outline"}
                            size="sm"
                            onClick={() => setSelectedGoodId(item.goodId)}
                          >
                            {selectedGoodId === item.goodId ? 'Selected' : 'Select'}
                          </Button>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
            
            {selectedGoodId && (
              <div className="p-4 rounded-md border">
                <h3 className="font-bold mb-2">Sale Details</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">Quantity</label>
                    <Input 
                      type="number" 
                      min="1" 
                      max={getInventoryQuantity(selectedGoodId)}
                      value={quantity}
                      onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Total Earnings</label>
                    <div className="text-xl font-bold text-green-600">
                      {(portGoods.find(pg => pg.goodId === selectedGoodId)?.currentPrice || 0) * quantity} gold
                    </div>
                  </div>
                </div>
                
                <Button className="w-full mt-4" onClick={handleTrade}>
                  <ShoppingCart className="mr-2 h-4 w-4" />
                  Sell Goods
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
        
        <DialogFooter className="flex justify-between items-center">
          <div className="flex items-center">
            <Info className="h-4 w-4 mr-1 text-blue-500" />
            <span className="text-xs text-muted-foreground">
              Prices change over time. Buy low, sell high!
            </span>
          </div>
          <Button variant="outline" onClick={handleClose}>
            <X className="mr-2 h-4 w-4" />
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
