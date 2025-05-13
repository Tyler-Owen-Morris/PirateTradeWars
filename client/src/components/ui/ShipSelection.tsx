import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card";
import { Button } from "./button";
import { useShip } from "@/lib/stores/useShip";
import { useGameState } from "@/lib/stores/useGameState";
import { useSocket } from "@/lib/stores/useSocket";
import { Alert, AlertDescription } from "./alert";
import { AlertCircle, Loader2, HelpCircle } from "lucide-react";
import { SHIP_TYPES, SHIP_DESCRIPTIONS, SHIP_PRICES, SHIP_STATS, SHIP_DISPLAY_NAMES, SHIP_UPGRADE_PATH } from "@shared/gameConstants";
import PaymentModal from "./PaymentModal";
import pirateNamesData from "./pirateNames.json";

const InstructionsModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState("overview");

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-[1000] p-4"
      onClick={onClose}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <Card
        className="w-full max-w-3xl bg-gray-900 border-amber-500 border-2 rounded-xl flex flex-col"
        style={{ height: "80vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <CardHeader className="bg-amber-900 text-amber-100 rounded-t-xl relative flex-none">
          <CardTitle className="text-2xl text-center">Game Instructions</CardTitle>
          <button
            className="absolute top-4 right-4 text-amber-200 hover:text-amber-400"
            onClick={onClose}
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </CardHeader>
        <div className="flex-none bg-amber-900/50 px-4 py-2">
          <div className="flex flex-wrap gap-2">
            {["overview", "ships", "rules", "faq"].map((tab) => (
              <Button
                key={tab}
                className={`px-4 py-2 text-sm font-bold rounded-md ${activeTab === tab
                  ? "bg-amber-600 text-white"
                  : "bg-amber-900 text-amber-200 hover:bg-amber-700"
                  }`}
                onClick={() => handleTabChange(tab)}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Button>
            ))}
          </div>
        </div>
        <CardContent className="flex-1 overflow-y-auto p-4">
          {activeTab === "overview" && (
            <div className="text-amber-100">
              <h3 className="text-xl font-bold mb-2">Welcome to Pirate Trade Wars</h3>
              <p>Sail an infinite ocean, battle rival ships, and claim riches across 16 scattered islands. Choose your starting ship, upgrade to larger more formidable ships, and become the ultimate pirate legend!</p>
              <ul className="list-disc ml-6 mt-2">
                <li><span className="font-semibold">Objective</span>: Amass wealth through combat or trade.</li>
                <li><span className="font-semibold">World</span>: A seamless, infinite, wrapping WaterWorld with no landmasses, only islands.</li>
                <li><span className="font-semibold">Gameplay</span>: Real-time naval combat and economic trading between islands.</li>
              </ul>
            </div>
          )}

          {activeTab === "ships" && (
            <div className="text-amber-100">
              <h3 className="text-xl font-bold mb-2">Ships & Stats</h3>
              <p>There are 5 ships, each with unique stats. The sloop is free; others require purchase via Stripe, and the dreadnaught can only acquired with ingame money. Game currency can be earned by winning battles or trading at islands (not available for purchase).</p>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse mt-4 text-sm">
                  <thead>
                    <tr className="bg-amber-900 text-amber-100">
                      <th className="p-2">Ship</th>
                      <th className="p-2">Speed</th>
                      <th className="p-2">Cannons</th>
                      <th className="p-2">Hull</th>
                      <th className="p-2">Armor</th>
                      <th className="p-2">Cost</th>
                      <th className="p-2">Upgrade Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(SHIP_STATS).map(([shipType, stats], index) => {
                      const upgradeInfo = SHIP_UPGRADE_PATH.find(upgrade => upgrade.to === shipType);
                      return (
                        <tr key={shipType} className={index % 2 === 0 ? "bg-gray-800" : "bg-gray-700"}>
                          <td className="p-2">{SHIP_DISPLAY_NAMES[shipType]}</td>
                          <td>{stats.speed}</td>
                          <td>{stats.cannonCount} ({stats.cannonDamage} dmg)</td>
                          <td>{stats.hullStrength} HP</td>
                          <td>{stats.armor}</td>
                          <td>{shipType === SHIP_TYPES.SLOOP ? "Free" :
                            shipType === SHIP_TYPES.DREADNAUGHT ? "In-game upgrade" :
                              `$${(SHIP_PRICES[shipType] / 100).toFixed(2)}`}</td>
                          <td>{shipType === SHIP_TYPES.SLOOP ? "-" :
                            upgradeInfo ? `${upgradeInfo.cost.toLocaleString()} gold` : "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-4"><span className="font-semibold">Upgrades</span>: Upgrade to the next ship tier to increase your trade capacity and combat power.</p>
            </div>
          )}

          {activeTab === "rules" && (
            <div className="text-amber-100">
              <h3 className="text-xl font-bold mb-2">Gameplay Rules</h3>
              <ul className="list-disc ml-6">
                <li><span className="font-semibold">Combat</span>: All ships have cannons firing 90° to their bow. Position strategically to hit enemies.</li>
                <li><span className="font-semibold">Navigation</span>: Sail an infinite ocean that wraps around. Find 16 islands for resources or search for other pirates to do battle.</li>
                <li><span className="font-semibold">Stats</span>:
                  <ul className="list-circle ml-6">
                    <li><span className="font-semibold">Speed</span>: Determines movement rate.</li>
                    <li><span className="font-semibold">Cannons</span>: Number of guns for damage output.</li>
                    <li><span className="font-semibold">Hull</span>: Cargo and crew capacity.</li>
                    <li><span className="font-semibold">Armor</span>: Damage resistance.</li>
                  </ul>
                </li>
                <li><span className="font-semibold">Islands</span>: Visit for trade, repairs, or quests. No permanent landmasses exist.</li>
              </ul>
            </div>
          )}

          {activeTab === "faq" && (
            <div className="text-amber-100">
              <h3 className="text-xl font-bold mb-2">FAQ</h3>
              <ul className="list-disc ml-6">
                <li><span className="font-semibold">What happens if my ship sinks?</span> Your score is recorded on the leaderboard (only if it's greater than 0), and your game is over. You will return to the main menu, and you can start a new game.</li>
                <li><span className="font-semibold">How do I earn money?</span> The safest way to earn money is to buy low and sell high, sailing between islands to find the best deals. Players drop their gold when they are destroyed though, so you can also get rich by sinking other players after their hulls are full of gold!</li>
                <li><span className="font-semibold">Can I play with friends?</span> Yes! PTW is a multiplayer game. Every player you see is another person playing the game. You can use the QR code in the game to easily add people to the game, or they can visit <a href="https://play.piratetradewars.com" target="_blank" rel="noopener noreferrer">piratetradewars.com</a> to join the game.</li>
                <li><span className="font-semibold">What is this?</span> This is a simple passion project made for fun by one person. The idea was to lean as heavily on AI as possible, and see how far I could get with my coding skills (I'm a software engineer by trade). After a few short weeks, I made something I enjoyed - so here it is, and I hope you enjoy it too! (Don't go too hard on me! I'm only one person...)</li>
              </ul>
            </div>
          )}
        </CardContent>
        <CardFooter className="bg-amber-900 p-4 rounded-b-xl flex-none">
          <Button
            className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold"
            onClick={onClose}
          >
            Close
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
};

export default function ShipSelection() {
  const {
    ships,
    selectedShip,
    fetchShips,
    selectShip,
    error: shipError,
  } = useShip();
  const { startGame, isRegistered } = useGameState();
  const { register, error: socketError, connected } = useSocket();
  const [loading, setLoading] = useState(false);
  const [playerName, setPlayerName] = useState("");
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [tempPlayerId, setTempPlayerId] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [promotionCode, setPromotionCode] = useState("");
  const [discountedAmount, setDiscountedAmount] = useState<number | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponApplied, setCouponApplied] = useState(false);

  // Log current state for debugging
  useEffect(() => {
    // console.log("ShipSelection component state:", {
    //   selectedShip,
    //   playerName,
    //   connected,
    //   isRegistered,
    //   socketError,
    //   shipError,
    // });
  }, [
    selectedShip,
    playerName,
    connected,
    isRegistered,
    socketError,
    shipError,
  ]);

  // Get player name from URL parameter or local storage
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const name = params.get("name");

    if (name) {
      console.log("Found name in URL:", name);
      setPlayerName(name);
    } else {
      const storedName = localStorage.getItem("playerName");
      if (storedName) {
        console.log("Found name in localStorage:", storedName);
        setPlayerName(storedName);
      }
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

  // Listen for successful registration
  useEffect(() => {
    if (isRegistered && !socketError) {
      console.log("Registration confirmed successful, starting game");
      startGame();
    }
  }, [isRegistered, socketError, startGame]);

  const generatePirateName = () => {
    useSocket.getState().resetError();
    const { prefixes, middleNames, suffixes } = pirateNamesData;
    const structure = Math.random();
    let usePrefix = false;
    let useSuffix = false;
    if (structure < 0.3) {
      usePrefix = true;
    } else if (structure < 0.6) {
      useSuffix = true;
    } else {
      usePrefix = true;
      useSuffix = true;
    }
    const middleName = middleNames[Math.floor(Math.random() * middleNames.length)];
    let prefix = '';
    let prefixTags: string[] = [];
    if (usePrefix) {
      const prefixObj = prefixes[Math.floor(Math.random() * prefixes.length)];
      prefix = prefixObj.name;
      prefixTags = prefixObj.tags;
    }
    let suffix = '';
    if (useSuffix) {
      let availableSuffixes = suffixes;
      if (usePrefix && prefixTags.includes('descriptor')) {
        availableSuffixes = suffixes.filter(s => !s.tags.includes('descriptor'));
      }
      const suffixObj = availableSuffixes[Math.floor(Math.random() * availableSuffixes.length)];
      suffix = suffixObj.name;
    }
    const fullName = [prefix, middleName, suffix].filter(part => part !== '').join(' ');
    setPlayerName(fullName);
    localStorage.setItem("playerName", fullName);
  };

  const checkNameAvailability = async (name: string): Promise<{ available: boolean; tempPlayerId?: string }> => {
    try {
      const response = await fetch(`/api/check-name?name=${encodeURIComponent(name)}`);
      if (!response.ok) throw new Error('Server error checking name');
      const data = await response.json();
      console.log("checkNameAvailability response:", data);
      if (!data.available) {
        alert('This name is already in use. Please choose a different name.');
        return { available: false };
      }
      return { available: true, tempPlayerId: data.tempPlayerId };
    } catch (error) {
      console.error('Error checking name availability:', error);
      setNameError("Name already in use by an active player");
      return { available: false };
    }
  };

  const launchStripeCheckout = async (ship: any, tempPlayerId: string) => {
    try {
      localStorage.removeItem('link_auth_session_client_secret');
      const response = await fetch('/api/stripe/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipName: ship.name,
          amount: SHIP_PRICES[ship.name],
          currency: 'usd',
          playerName,
          tempPlayerId,
          promotionCode: promotionCode || '',
        }),
      });
      console.log("initiate payment response:", response);
      const { clientSecret, error, amount, couponApplied, couponError } = await response.json();
      if (error) {
        throw new Error(error);
      }
      if (!clientSecret) throw new Error('Failed to create payment intent');
      setClientSecret(clientSecret);
      setDiscountedAmount(amount);
      setCouponApplied(couponApplied || false);
      setCouponError(couponError);
      setShowPaymentModal(true);
    } catch (error: any) {
      console.error('Error initiating payment:', error);
      setNameError(error.message || "Failed to initiate payment. Please try again.");
      await fetch('/api/release-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: playerName, tempPlayerId }),
      });
    }
  };

  const handlePaymentSuccess = () => {
    if (!selectedShip || !tempPlayerId) {
      console.error('Cannot start game: missing ship or tempPlayerId');
      return;
    }
    register(playerName, selectedShip.name, tempPlayerId);
  };

  const handlePaymentError = (error: { message: string; type?: string; code?: string }) => {
    const errorMessage = error.message || 'Payment failed. Please try again.';
    setNameError(errorMessage);
    console.error("Payment error:", {
      message: errorMessage,
      type: error.type,
      code: error.code,
    });
    setTempPlayerId(null);
    if (playerName && tempPlayerId) {
      fetch('/api/release-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: playerName, tempPlayerId }),
      }).catch((err) => console.error('Error releasing name:', err));
    }
    localStorage.removeItem('playerId');
  };

  const handleStartGame = async () => {
    if (!selectedShip || !playerName || playerName.length < 3) {
      console.log("Cannot start game: missing requirements", {
        hasShip: !!selectedShip,
        playerName,
        nameLength: playerName?.length,
      });
      return;
    }
    console.log("selectedShip:", selectedShip);

    useSocket.getState().resetError();
    setNameError(null);

    if (selectedShip.isPaid) {
      const { available, tempPlayerId } = await checkNameAvailability(playerName);
      console.log("checkNameAvailability:", { available, tempPlayerId });
      if (available && tempPlayerId) {
        setTempPlayerId(tempPlayerId);
        launchStripeCheckout(selectedShip, tempPlayerId);
      }
    } else {
      console.log(
        "Starting game with ship:",
        selectedShip.name,
        "and player name:",
        playerName,
      );
      setLoading(true);
      try {
        if (!connected) {
          console.log("Connecting to WebSocket...");
          useSocket.getState().connect();
        }
        setTimeout(
          () => {
            try {
              console.log("Registering player with WebSocket...");
              register(playerName, selectedShip.name);
            } catch (innerError) {
              console.error("Error during game start sequence:", innerError);
              setLoading(false);
            }
          },
          connected ? 0 : 500,
        );
      } catch (error) {
        console.error("Error starting game:", error);
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (socketError) {
      setLoading(false);
    }
  }, [socketError]);

  if (loading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-b from-gray-900 to-gray-800">
        <div className="flex flex-col items-center">
          <Loader2 className="h-12 w-12 text-amber-500 animate-spin" />
          <p className="mt-4 text-white text-lg">Preparing your ship...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-b from-gray-900 to-gray-800 p-4">
      <Card className="w-full max-w-5xl border-amber-500 border flex flex-col rounded-xl" style={{
        maxHeight: '83vh',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        zIndex: 1
      }}>
        <CardHeader className="bg-amber-900 text-white rounded-t-xl sticky top-0" style={{
          zIndex: 1
        }}>
          <CardTitle className="text-2xl md:text-3xl text-center">
            Choose Your <span className="text-amber-100">Captain's Name</span> and <span className="text-amber-100">Ship</span>
          </CardTitle>
          <div className="mt-4">
            <label
              htmlFor="playerName"
              className="block text-sm font-medium mb-2 text-white"
            >
              Your Captain's Name:
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                id="playerName"
                className="px-3 py-2 bg-gray-100 text-black border border-amber-300 rounded-md w-full text-sm"
                value={playerName}
                onChange={(e) => {
                  setPlayerName(e.target.value);
                  localStorage.setItem("playerName", e.target.value);
                }}
                placeholder="Enter your name (min. 3 characters)"
              />
              <Button
                onClick={generatePirateName}
                className="bg-amber-700 hover:bg-amber-600 text-white py-2 px-4 rounded-md transition text-sm whitespace-nowrap"
                data-testid="cypress-generate-random-name-button"
              >
                Random Name
              </Button>
            </div>
          </div>
          {(shipError || socketError || nameError) && (
            <Alert onClick={() => { setNameError(null); useSocket.getState().resetError(); }} variant="destructive" className="mb-4 bg-red-900/90 border-red-700">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 mt-0.5 text-red-200" />
                <AlertDescription className="text-red-100">
                  {shipError || socketError || nameError}
                </AlertDescription>
              </div>
            </Alert>
          )}
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                type: SHIP_TYPES.SLOOP,
                name: SHIP_DISPLAY_NAMES[SHIP_TYPES.SLOOP],
                tier: "Free",
                color: "blue-100",
                stats: {
                  price: "Free",
                  ttl: `${SHIP_STATS[SHIP_TYPES.SLOOP].playerTTL / 60} min`,
                  hull: `${SHIP_STATS[SHIP_TYPES.SLOOP].hullStrength} HP`,
                  cargo: `${SHIP_STATS[SHIP_TYPES.SLOOP].cargoCapacity} units`,
                  cannons: `${SHIP_STATS[SHIP_TYPES.SLOOP].cannonCount} (${SHIP_STATS[SHIP_TYPES.SLOOP].cannonDamage} dmg)`,
                  startingGold: `${SHIP_STATS[SHIP_TYPES.SLOOP].startingGold}`,
                },
                testId: "cypress-sloop-card",
              },
              {
                type: SHIP_TYPES.BRIGANTINE,
                name: SHIP_DISPLAY_NAMES[SHIP_TYPES.BRIGANTINE],
                tier: "Premium Tier 1",
                color: "green-100",
                stats: {
                  price: `$${(SHIP_PRICES[SHIP_TYPES.BRIGANTINE] / 100).toFixed(2)}`,
                  ttl: `${(SHIP_STATS[SHIP_TYPES.BRIGANTINE].playerTTL / 60) / 60} hour`,
                  hull: `${SHIP_STATS[SHIP_TYPES.BRIGANTINE].hullStrength} HP`,
                  cargo: `${SHIP_STATS[SHIP_TYPES.BRIGANTINE].cargoCapacity} units`,
                  cannons: `${SHIP_STATS[SHIP_TYPES.BRIGANTINE].cannonCount} (${SHIP_STATS[SHIP_TYPES.BRIGANTINE].cannonDamage} dmg)`,
                  startingGold: `${SHIP_STATS[SHIP_TYPES.BRIGANTINE].startingGold}`,
                },
                testId: "cypress-brigantine-card",
              },
              {
                type: SHIP_TYPES.GALLEON,
                name: SHIP_DISPLAY_NAMES[SHIP_TYPES.GALLEON],
                tier: "Premium Tier 2",
                color: "yellow-100",
                stats: {
                  price: `$${(SHIP_PRICES[SHIP_TYPES.GALLEON] / 100).toFixed(2)}`,
                  ttl: `${(SHIP_STATS[SHIP_TYPES.GALLEON].playerTTL / 60) / 60} hours`,
                  hull: `${SHIP_STATS[SHIP_TYPES.GALLEON].hullStrength} HP`,
                  cargo: `${SHIP_STATS[SHIP_TYPES.GALLEON].cargoCapacity} units`,
                  cannons: `${SHIP_STATS[SHIP_TYPES.GALLEON].cannonCount} (${SHIP_STATS[SHIP_TYPES.GALLEON].cannonDamage} dmg)`,
                  startingGold: `${SHIP_STATS[SHIP_TYPES.GALLEON].startingGold}`,
                },
                testId: "cypress-galleon-card",
              },
              {
                type: SHIP_TYPES.MAN_O_WAR,
                name: SHIP_DISPLAY_NAMES[SHIP_TYPES.MAN_O_WAR],
                tier: "Premium Tier 3",
                color: "red-100",
                stats: {
                  price: `$${(SHIP_PRICES[SHIP_TYPES.MAN_O_WAR] / 100).toFixed(2)}`,
                  ttl: `${(SHIP_STATS[SHIP_TYPES.MAN_O_WAR].playerTTL / 60) / 60} hours`,
                  hull: `${SHIP_STATS[SHIP_TYPES.MAN_O_WAR].hullStrength} HP`,
                  cargo: `${SHIP_STATS[SHIP_TYPES.MAN_O_WAR].cargoCapacity} units`,
                  cannons: `${SHIP_STATS[SHIP_TYPES.MAN_O_WAR].cannonCount} (${SHIP_STATS[SHIP_TYPES.MAN_O_WAR].cannonDamage} dmg)`,
                  startingGold: `${SHIP_STATS[SHIP_TYPES.MAN_O_WAR].startingGold}`,
                },
                testId: "cypress-man-o-war-card",
              },
            ].map((ship) => (
              <Card
                key={ship.type}
                className={`cursor-pointer transition-all transform hover:scale-105 rounded-xl overflow-hidden ${selectedShip?.name === ship.type
                  ? "border-amber-500 border-4 shadow-lg shadow-amber-500/50 bg-amber-50"
                  : "bg-gray-50 border-2 border-transparent"
                  }`}
                onClick={() => handleShipSelect(ship.type)}
                data-testid={ship.testId}
              >
                <CardHeader className="p-3 bg-amber-100 relative">
                  <CardTitle className="text-lg text-amber-900 pr-16">{ship.name}</CardTitle>
                  <CardDescription className="text-xs text-amber-700">{ship.tier}</CardDescription>
                  <div className="absolute top-3 right-3 bg-amber-600 text-white text-xs font-bold px-2 py-1 rounded-full">
                    {ship.stats.price}
                  </div>
                </CardHeader>
                <CardContent className="p-3">
                  <div className={`h-32 bg-${ship.color} rounded-lg flex items-center justify-center border border-amber-200`}>
                    <img
                      src={`/images/ships/${ship.type.toLowerCase()}.jpg`}
                      alt={ship.name}
                      className="object-cover h-full w-full rounded-lg"
                    />
                  </div>
                  <div className="mt-3 text-xs text-gray-800">
                    <p className="mb-2 text-xsm h-10">{SHIP_DESCRIPTIONS[ship.type]}</p>
                    <ul className="space-y-1">
                      <li>
                        <span className="font-bold text-amber-700 text-sm">Persistence:</span>
                        <span className="ml-1 text-amber-600 font-semibold text-sm">{ship.stats.ttl}</span>
                      </li>
                      <li><span className="font-semibold">Hull:</span> {ship.stats.hull}</li>
                      <li><span className="font-semibold">Cargo:</span> {ship.stats.cargo}</li>
                      <li><span className="font-semibold">Cannons:</span> {ship.stats.cannons}</li>
                      <li><span className="font-semibold">Starting Gold:</span> {ship.stats.startingGold}</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>

        <CardFooter className="flex flex-col sm:flex-row items-center justify-center p-4 bg-amber-900 rounded-b-xl sticky bottom-0 gap-4" style={{
          paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 20px))',
          zIndex: 1
        }}>
          <div className="w-full sm:w-1/3 mb-4">
            <label
              htmlFor="promotionCode"
              className="block text-sm font-medium mb-2 text-white"
            >
              Promotion Code (optional):
            </label>
            <input
              type="text"
              id="promotionCode"
              className="px-3 py-2 bg-gray-100 text-black border border-amber-300 rounded-md w-full text-sm"
              value={promotionCode}
              onChange={(e) => setPromotionCode(e.target.value.toUpperCase())}
              placeholder="Enter promotion code (e.g., FREESHIP2025)"
            />
          </div>
          <Button
            onClick={handleStartGame}
            disabled={!selectedShip || !playerName || playerName.length < 3 || loading}
            className="w-full sm:w-1/3 bg-amber-600 hover:bg-amber-700 text-white font-bold border-2 border-amber-200 text-sm py-3 rounded-lg"
            data-testid="cypress-start-game-button"
          >
            {loading ? "Preparing Ship..." : "Set Sail!"}
          </Button>
          {!playerName && (
            <p className="text-sm text-amber-200 text-center">Enter your name first!</p>
          )}
          {playerName && playerName.length < 3 && (
            <p className="text-sm text-amber-200 text-center">Name must be at least 3 characters</p>
          )}
          <button
            onClick={() => setShowInstructions(true)}
            className="fixed bottom-6 right-6 w-10 h-10 rounded-full bg-amber-600 hover:bg-amber-700 text-white flex items-center justify-center shadow-lg transition-transform hover:scale-110 z-50"
            style={{
              marginBottom: 'env(safe-area-inset-bottom, 0)',
              marginRight: 'env(safe-area-inset-right, 0)'
            }}
          >
            <HelpCircle className="w-5 h-5" />
          </button>
        </CardFooter>
      </Card>
      {showPaymentModal && clientSecret && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999 }}>
          <PaymentModal
            isOpen={showPaymentModal}
            onClose={async () => {
              setShowPaymentModal(false);
              if (!useSocket.getState().playerId) {
                await fetch('/api/release-name', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: playerName, tempPlayerId: tempPlayerId }),
                });
              }
            }}
            onSuccess={handlePaymentSuccess}
            onError={handlePaymentError}
            clientSecret={clientSecret}
            shipName={selectedShip?.name || ''}
            amount={discountedAmount || SHIP_PRICES[selectedShip?.name || '']}
            originalAmount={SHIP_PRICES[selectedShip?.name || '']}
            couponApplied={couponApplied}
            couponError={couponError}
          />
        </div>
      )}
      <InstructionsModal
        isOpen={showInstructions}
        onClose={() => setShowInstructions(false)}
      />
    </div>
  );
}