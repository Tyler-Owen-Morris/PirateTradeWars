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
  
  // Update local inventory when game state inventory changes
  useEffect(() => {
    // Add good details to inventory items
    const itemsWithGoods = gameState.inventory.map(item => ({
      ...item,
      good: GOODS.find(g => g.id === item.goodId)
    }));
    
    setInventory(itemsWithGoods);
    
    // Log for debugging
    console.log("Inventory updated from game state:", gameState.inventory);
  }, [gameState.inventory]);
  
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
          // Update the global game state first
          useGameState.getState().updatePlayerInventory(inventoryItems);
          
          // Add good details to inventory items (will be done by the useEffect)
          console.log("Loaded inventory from API:", inventoryItems);
        } else {
          console.log("No inventory items received from API");
          // Leave global state untouched, don't set empty inventory here
        }
      } catch (error) {
        console.error('Failed to load inventory:', error);
        // Don't modify anything on error
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
    
    // Note: We don't need to reload data here anymore
    // The inventory will be updated via socket message
  };
  
  // Handle buying maximum possible quantity
  const handleBuyMax = () => {
    if (!currentPort || !selectedGoodId || !gameState.player) {
      setError('Unable to complete trade');
      return;
    }
    
    // Get port good
    const portGood = portGoods.find(pg => pg.goodId === selectedGoodId);
    if (!portGood) {
      setError('Good not available at this port');
      return;
    }
    
    // Calculate max quantity based on three constraints:
    // 1. Available stock at port
    // 2. Player's gold
    // 3. Available cargo space
    
    const pricePerUnit = portGood.currentPrice;
    const availableStock = portGood.stock;
    const playerGold = gameState.player.gold;
    const availableCargoSpace = gameState.player.cargoCapacity - gameState.player.cargoUsed;
    
    // Max based on player's gold
    const maxByGold = Math.floor(playerGold / pricePerUnit);
    
    // Find the minimum of all constraints
    const maxQuantity = Math.min(
      availableStock,
      maxByGold,
      availableCargoSpace
    );
    
    if (maxQuantity <= 0) {
      if (availableStock <= 0) {
        setError('No stock available at this port.');
      } else if (maxByGold <= 0) {
        setError('You don\'t have enough gold to buy any units.');
      } else if (availableCargoSpace <= 0) {
        setError('Your cargo hold is full.');
      } else {
        setError('Unable to buy any units.');
      }
      return;
    }
    
    // Set the quantity to max and execute the trade
    setQuantity(maxQuantity);
    
    // Execute trade with max quantity
    sendTrade(currentPort.id, 'buy', selectedGoodId, maxQuantity);
    
    // Reset form
    setSelectedGoodId(null);
    setQuantity(1);
  };
  
  // Handle selling maximum possible quantity
  const handleSellMax = () => {
    if (!currentPort || !selectedGoodId || !gameState.player) {
      setError('Unable to complete trade');
      return;
    }
    
    // Get the inventory quantity of the selected good
    const inventoryQuantity = getInventoryQuantity(selectedGoodId);
    if (inventoryQuantity <= 0) {
      setError('You don\'t have any of this good to sell.');
      return;
    }
    
    // For selling, we only need to consider how much the player owns
    const maxQuantity = inventoryQuantity;
    
    // Execute trade with max quantity
    sendTrade(currentPort.id, 'sell', selectedGoodId, maxQuantity);
    
    // Reset form
    setSelectedGoodId(null);
    setQuantity(1);
  };
  
  // Close dialog
  const handleClose = () => {
    setIsTrading(false);
  };
  
  return (
    <Dialog open={isTrading} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-screen overflow-y-auto bg-slate-800 text-white border-amber-500">
        <DialogHeader className="bg-amber-900 rounded-t-md p-4">
          <DialogTitle className="flex items-center text-amber-100">
            <Tag className="mr-2 h-5 w-5" />
            {currentPort ? currentPort.name : 'Port'} Trading Post
          </DialogTitle>
          <DialogDescription className="text-amber-200">
            Buy and sell goods to increase your wealth
          </DialogDescription>
        </DialogHeader>
        
        {(error || socketError) && (
          <Alert variant="destructive" className="mb-4 mt-4 border border-red-500 bg-red-900/50">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-white">
              {error || socketError}
            </AlertDescription>
          </Alert>
        )}
        
        {gameState.player && (
          <div className="flex items-center justify-between mb-4 p-3 bg-amber-800/40 rounded-md border border-amber-500/50">
            <div className="flex items-center">
              <Coins className="h-5 w-5 mr-2 text-yellow-500" />
              <span className="font-bold text-amber-200">{gameState.player.gold}</span>
              <span className="ml-1 text-sm text-amber-100">gold</span>
            </div>
            <div className="flex items-center">
              <Package className="h-5 w-5 mr-2 text-amber-300" />
              <span className="text-amber-200">{gameState.player.cargoUsed} / {gameState.player.cargoCapacity}</span>
              <span className="ml-1 text-sm text-amber-100">cargo</span>
            </div>
          </div>
        )}
        
        <Tabs 
          defaultValue="buy" 
          value={tab} 
          onValueChange={(newTab) => {
            setTab(newTab);
            // If switching to sell tab, make sure to update inventory
            if (newTab === 'sell') {
              loadInventory();
            }
          }} 
          className="mt-4">
          <TabsList className="grid w-full grid-cols-2 bg-amber-900 border border-amber-500">
            <TabsTrigger value="buy" className="text-amber-200 data-[state=active]:bg-amber-700 data-[state=active]:text-white">Buy Goods</TabsTrigger>
            <TabsTrigger value="sell" className="text-amber-200 data-[state=active]:bg-amber-700 data-[state=active]:text-white">Sell Goods</TabsTrigger>
          </TabsList>
          
          <TabsContent value="buy" className="space-y-4">
            <div className="rounded-md border border-amber-500/50 overflow-hidden">
              <div className="flex items-center p-3 bg-amber-900/70 text-amber-100 font-medium">
                <div className="w-1/4">Good</div>
                <div className="w-1/4 text-center">Price</div>
                <div className="w-1/4 text-center">Stock</div>
                <div className="w-1/4 text-center">Action</div>
              </div>
              
              {loading ? (
                <div className="p-8 text-center text-amber-100">Loading goods...</div>
              ) : portGoods.length === 0 ? (
                <div className="p-8 text-center text-amber-100">
                  <p>No goods available at this port</p>
                  <p className="mt-4 text-sm">This is a new port - goods will be restocked on your next visit!</p>
                </div>
              ) : (
                portGoods.map((portGood) => {
                  const good = findGood(portGood.goodId);
                  if (!good) return null;
                  
                  return (
                    <div 
                      key={portGood.id} 
                      className={`flex items-center p-3 border-t border-amber-500/20 ${
                        selectedGoodId === portGood.goodId 
                          ? 'bg-amber-700/50 text-amber-50' 
                          : 'hover:bg-amber-800/30'
                      }`}
                    >
                      <div className="w-1/4 font-medium">{good.name}</div>
                      <div className="w-1/4 text-center">
                        <span className="text-yellow-300">{portGood.currentPrice}</span> gold
                      </div>
                      <div className="w-1/4 text-center">{portGood.stock} units</div>
                      <div className="w-1/4 text-center">
                        <Button 
                          variant={selectedGoodId === portGood.goodId ? "default" : "outline"}
                          size="sm"
                          onClick={() => setSelectedGoodId(portGood.goodId)}
                          disabled={portGood.stock === 0}
                          className={selectedGoodId === portGood.goodId 
                            ? "bg-amber-500 hover:bg-amber-600 text-white" 
                            : "border-amber-400 text-amber-200 hover:bg-amber-800"}
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
              <div className="p-4 rounded-md border border-amber-500/50 bg-amber-900/30">
                <h3 className="font-bold mb-3 text-amber-200 flex items-center">
                  <ShoppingCart className="mr-2 h-5 w-5 text-amber-300" />
                  Purchase Details
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block text-amber-100">Quantity</label>
                    <Input 
                      type="number" 
                      min="1" 
                      max={portGoods.find(pg => pg.goodId === selectedGoodId)?.stock || 1}
                      value={quantity}
                      onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                      className="bg-amber-950 border-amber-500/50 text-amber-100"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block text-amber-100">Total Cost</label>
                    <div className="text-xl font-bold text-yellow-400 flex items-center">
                      <Coins className="mr-2 h-5 w-5 text-yellow-500" />
                      {(portGoods.find(pg => pg.goodId === selectedGoodId)?.currentPrice || 0) * quantity} gold
                    </div>
                  </div>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-2 mt-4">
                  <Button 
                    className="flex-1 bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={handleTrade}
                  >
                    <ShoppingCart className="mr-2 h-4 w-4" />
                    Buy Goods
                  </Button>
                  <Button 
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white"
                    onClick={handleBuyMax}
                  >
                    <Coins className="mr-2 h-4 w-4" />
                    Buy Max
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="sell" className="space-y-4">
            <div className="rounded-md border border-amber-500/50 overflow-hidden">
              <div className="flex items-center p-3 bg-amber-900/70 text-amber-100 font-medium">
                <div className="w-1/4">Good</div>
                <div className="w-1/4 text-center">Price</div>
                <div className="w-1/4 text-center">Owned</div>
                <div className="w-1/4 text-center">Action</div>
              </div>
              
              {loading ? (
                <div className="p-8 text-center text-amber-100">Loading inventory...</div>
              ) : inventory.filter(item => item.quantity > 0).length === 0 ? (
                <div className="p-8 text-center text-amber-100">
                  <p>Your cargo hold is empty</p>
                  <p className="mt-4 text-sm">Buy goods to sell them at other ports for profit!</p>
                </div>
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
                        className={`flex items-center p-3 border-t border-amber-500/20 ${
                          selectedGoodId === item.goodId 
                            ? 'bg-amber-700/50 text-amber-50' 
                            : 'hover:bg-amber-800/30'
                        }`}
                      >
                        <div className="w-1/4 font-medium">{good.name}</div>
                        <div className="w-1/4 text-center">
                          <span className="text-yellow-300">{price}</span> gold
                        </div>
                        <div className="w-1/4 text-center">{item.quantity} units</div>
                        <div className="w-1/4 text-center">
                          <Button 
                            variant={selectedGoodId === item.goodId ? "default" : "outline"}
                            size="sm"
                            onClick={() => setSelectedGoodId(item.goodId)}
                            className={selectedGoodId === item.goodId 
                              ? "bg-amber-500 hover:bg-amber-600 text-white" 
                              : "border-amber-400 text-amber-200 hover:bg-amber-800"}
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
              <div className="p-4 rounded-md border border-amber-500/50 bg-amber-900/30">
                <h3 className="font-bold mb-3 text-amber-200 flex items-center">
                  <Tag className="mr-2 h-5 w-5 text-amber-300" />
                  Sale Details
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block text-amber-100">Quantity</label>
                    <Input 
                      type="number" 
                      min="1" 
                      max={getInventoryQuantity(selectedGoodId)}
                      value={quantity}
                      onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                      className="bg-amber-950 border-amber-500/50 text-amber-100"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block text-amber-100">Total Earnings</label>
                    <div className="text-xl font-bold text-green-400 flex items-center">
                      <Coins className="mr-2 h-5 w-5 text-green-500" />
                      {(portGoods.find(pg => pg.goodId === selectedGoodId)?.currentPrice || 0) * quantity} gold
                    </div>
                  </div>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-2 mt-4">
                  <Button 
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={handleTrade}
                  >
                    <Tag className="mr-2 h-4 w-4" />
                    Sell Goods
                  </Button>
                  <Button 
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                    onClick={handleSellMax}
                  >
                    <Coins className="mr-2 h-4 w-4" />
                    Sell Max
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
        
        <DialogFooter className="flex justify-between items-center mt-4 pt-4 border-t border-amber-500/30">
          <div className="flex items-center">
            <Info className="h-4 w-4 mr-1 text-amber-300" />
            <span className="text-xs text-amber-200">
              Prices change over time. Buy low, sell high!
            </span>
          </div>
          <Button variant="outline" onClick={handleClose} className="border-amber-400 text-amber-200 hover:bg-amber-800">
            <X className="mr-2 h-4 w-4" />
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
