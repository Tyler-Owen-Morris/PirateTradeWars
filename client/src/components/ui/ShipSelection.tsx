import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useShip } from "@/lib/stores/useShip";
import { useGameState } from "@/lib/stores/useGameState";
import { useSocket } from "@/lib/stores/useSocket";
import { AlertCircle, HelpCircle, X } from "lucide-react";
import {
  CompassRose,
  ParchmentPanel,
  PirateButton,
  SeaChartBackdrop,
  SectionTitle,
  TitleLockup,
  WaxSeal,
  WoodPanel,
} from "./pirate";
import { SHIP_TYPES, SHIP_DESCRIPTIONS, SHIP_PRICES, SHIP_STATS, SHIP_DISPLAY_NAMES, SHIP_UPGRADE_PATH } from "@shared/gameConstants";
import PaymentModal from "./PaymentModal";
import pirateNamesData from "./pirateNames.json";


// Add constant to control purchases
const PURCHASES_ENABLED = true;

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
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-[1000] p-3 sm:p-4"
      onClick={onClose}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <ParchmentPanel
        torn
        role="dialog"
        aria-modal="true"
        aria-labelledby="ptw-instructions-title"
        className="w-full max-w-3xl flex flex-col"
        style={{ height: "80vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative flex-none px-5 pt-6 pb-3">
          <SectionTitle id="ptw-instructions-title" className="text-3xl sm:text-4xl px-10">
            Game Instructions
          </SectionTitle>
          <PirateButton
            variant="porthole"
            size="sm"
            className="absolute top-5 right-5"
            onClick={onClose}
            aria-label="Close instructions"
          >
            <X />
          </PirateButton>
        </div>
        <div className="flex-none px-4 sm:px-5">
          <div role="tablist" aria-label="Instruction sections" className="ptw-tabs">
            {["overview", "ships", "rules", "faq"].map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                data-state={activeTab === tab ? "active" : "inactive"}
                className="ptw-tab"
                onClick={() => handleTabChange(tab)}
              >
                {tab === "faq" ? "FAQ" : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 sm:px-7 py-4 text-[1.05rem] leading-relaxed">
          {activeTab === "overview" && (
            <div>
              <h3 className="ptw-font-display text-2xl mb-2">Welcome to Pirate Trade Wars</h3>
              <p>Sail an infinite ocean, battle rival ships, and claim riches across 16 scattered islands. Choose your starting ship, upgrade to larger more formidable ships, and become the ultimate pirate legend!</p>
              <ul className="list-disc ml-6 mt-2">
                <li><span className="font-semibold">Objective</span>: Amass wealth through combat or trade.</li>
                <li><span className="font-semibold">World</span>: A seamless, infinite, wrapping WaterWorld with no landmasses, only islands.</li>
                <li><span className="font-semibold">Gameplay</span>: Real-time naval combat and economic trading between islands.</li>
              </ul>
            </div>
          )}

          {activeTab === "ships" && (
            <div>
              <h3 className="ptw-font-display text-2xl mb-2">Ships & Stats</h3>
              <p>There are 5 ships, each with unique stats. The sloop is free; others require purchase via Stripe, and the dreadnaught can only acquired with ingame money. Game currency can be earned by winning battles or trading at islands (not available for purchase).</p>
              <div className="overflow-x-auto">
                <table className="ptw-ledger ptw-num w-full text-left mt-4 text-sm">
                  <thead>
                    <tr>
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
                        <tr key={shipType}>
                          <td className="p-2 font-bold">{SHIP_DISPLAY_NAMES[shipType]}</td>
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
            <div>
              <h3 className="ptw-font-display text-2xl mb-2">Gameplay Rules</h3>
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
            <div>
              <h3 className="ptw-font-display text-2xl mb-2">FAQ</h3>
              <ul className="list-disc ml-6">
                <li><span className="font-semibold">What happens if my ship sinks?</span> Your score is recorded on the leaderboard (only if it's greater than 0), and your game is over. You will return to the main menu, and you can start a new game.</li>
                <li><span className="font-semibold">How do I earn money?</span> The safest way to earn money is to buy low and sell high, sailing between islands to find the best deals. Players drop their gold when they are destroyed though, so you can also get rich by sinking other players after their hulls are full of gold!</li>
                <li><span className="font-semibold">Can I play with friends?</span> Yes! PTW is a multiplayer game. Every player you see is another person playing the game. You can use the QR code in the game to easily add people to the game, or they can visit <a className="underline decoration-ptw-burn underline-offset-2 font-bold" href="https://play.piratetradewars.com" target="_blank" rel="noopener noreferrer">piratetradewars.com</a> to join the game.</li>
                <li><span className="font-semibold">What is this?</span> This is a simple passion project made for fun by one person. The idea was to lean as heavily on AI as possible, and see how far I could get with my coding skills (I'm a software engineer by trade). After a few short weeks, I made something I enjoyed - so here it is, and I hope you enjoy it too! (Don't go too hard on me! I'm only one person...)</li>
              </ul>
            </div>
          )}
        </div>
        <div className="flex-none px-5 pb-6 pt-2">
          <PirateButton block onClick={onClose}>
            Close
          </PirateButton>
        </div>
      </ParchmentPanel>
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
        }),
      });
      console.log("initiate payment response:", response);
      const { clientSecret } = await response.json();
      if (!clientSecret) throw new Error('Failed to create payment intent');
      setClientSecret(clientSecret);
      setShowPaymentModal(true);
    } catch (error) {
      console.error('Error initiating payment:', error);
      setNameError("Failed to initiate payment. Please try again.");
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

    if (selectedShip.isPaid && PURCHASES_ENABLED) {
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
      <div className="fixed inset-0">
        <SeaChartBackdrop />
        <div className="relative h-full flex flex-col items-center justify-center" role="status">
          <CompassRose className="h-24 w-24 text-ptw-brass motion-safe:animate-[spin_8s_linear_infinite]" />
          <p className="mt-5 ptw-font-label text-xl text-ptw-cream">Preparing your ship...</p>
        </div>
      </div>
    );
  }

  const nameTooShort = !!playerName && playerName.length < 3;

  return (
    <div className="fixed inset-0">
      <SeaChartBackdrop />
      <div className="absolute inset-0 overflow-y-auto overflow-x-hidden">
        <div className="relative min-h-full flex flex-col items-center px-3 sm:px-6 pt-8 sm:pt-12">
          <TitleLockup className="mb-6 sm:mb-10" />

          <WoodPanel className="w-full max-w-5xl flex flex-col mb-4" style={{ position: "relative", zIndex: 1 }}>
            <div className="px-4 sm:px-7 pt-6 pb-4">
              <SectionTitle className="text-[1.6rem] sm:text-3xl text-ptw-brass-hi">
                Choose Your Captain&rsquo;s Name and Ship
              </SectionTitle>
              <div className="mt-4 max-w-2xl mx-auto">
                <label htmlFor="playerName" className="ptw-label mb-1.5 text-ptw-cream">
                  Your Captain&rsquo;s Name
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    id="playerName"
                    className="ptw-input"
                    value={playerName}
                    onChange={(e) => {
                      setPlayerName(e.target.value);
                      localStorage.setItem("playerName", e.target.value);
                    }}
                    placeholder="Enter your name (min. 3 characters)"
                    autoComplete="off"
                  />
                  <PirateButton
                    variant="rope"
                    onClick={generatePirateName}
                    data-testid="cypress-generate-random-name-button"
                  >
                    Random Name
                  </PirateButton>
                </div>
                {(shipError || socketError || nameError) && (
                  <div
                    role="alert"
                    className="ptw-alert mt-3 cursor-pointer"
                    onClick={() => { setNameError(null); useSocket.getState().resetError(); }}
                  >
                    <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" aria-hidden="true" />
                    <span>{shipError || socketError || nameError}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="px-4 sm:px-7 pt-2 pb-7">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
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
                ].map((ship) => {
                  const selected = selectedShip?.name === ship.type;
                  return (
                    <div
                      key={ship.type}
                      role="button"
                      tabIndex={0}
                      aria-pressed={selected}
                      className={cn("ptw-card ptw-card--interactive", selected && "is-selected")}
                      onClick={() => handleShipSelect(ship.type)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleShipSelect(ship.type);
                        }
                      }}
                      data-testid={ship.testId}
                    >
                      <div className="relative px-3.5 pt-3.5 pb-2.5">
                        {selected && (
                          <span className="ptw-ribbon absolute -top-3 left-1/2 -translate-x-1/2 text-xs px-5 py-0.5 shadow" aria-hidden="true">
                            Your Ship
                          </span>
                        )}
                        <h3 className="ptw-font-display text-[1.6rem] leading-none pr-20">{ship.name}</h3>
                        <p className="ptw-font-label text-sm text-ptw-ink-soft mt-1">{ship.tier}</p>
                        <div className="absolute top-3 right-3 flex flex-col items-end gap-1">
                          {!PURCHASES_ENABLED && ship.type !== SHIP_TYPES.SLOOP && (
                            <span className="ptw-tag ptw-tag--green">Free</span>
                          )}
                          <span
                            className={cn(
                              "ptw-tag",
                              ship.type === SHIP_TYPES.SLOOP && "ptw-tag--green",
                              !PURCHASES_ENABLED && ship.type !== SHIP_TYPES.SLOOP && "line-through",
                            )}
                          >
                            {ship.stats.price}
                          </span>
                        </div>
                      </div>
                      <div className="relative px-3.5">
                        {selected && (
                          <WaxSeal emblem="skull" title="Chosen ship" className="absolute -bottom-4 right-1 h-14 w-14 z-[1] drop-shadow-[0_2px_2px_rgba(0,0,0,0.5)]" />
                        )}
                        <div className="ptw-plate h-32">
                          <img
                            src={`/images/ships/${ship.type.toLowerCase()}.jpg`}
                            alt={ship.name}
                            className="object-cover h-full w-full"
                          />
                        </div>
                      </div>
                      <div className="px-3.5 pt-3 pb-3.5 flex-1 flex flex-col">
                        <p className="italic leading-snug text-[0.95rem] text-ptw-ink-soft min-h-[2.6rem] mb-2">
                          {SHIP_DESCRIPTIONS[ship.type]}
                        </p>
                        <dl className="ptw-ledger ptw-num text-sm mt-auto">
                          {[
                            ["Persistence", ship.stats.ttl],
                            ["Hull", ship.stats.hull],
                            ["Cargo", ship.stats.cargo],
                            ["Cannons", ship.stats.cannons],
                            ["Starting Gold", ship.stats.startingGold],
                          ].map(([k, v], i) => (
                            <div key={k} className="ptw-ledger__row flex items-baseline justify-between gap-2 py-1 last:border-b-0">
                              <dt className="ptw-font-label">{k}</dt>
                              <dd className={cn("text-right", i === 0 ? "font-bold text-ptw-burn" : "font-medium")}>{v}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div
              className="sticky bottom-0 z-[2] ptw-wood ptw-wood--plain rounded-t-none rounded-b-[4px] border-x-0 border-b-0 border-t-2 border-t-ptw-brass/70 flex flex-col sm:flex-row items-center justify-center gap-3 px-4 pt-4"
              style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))", boxShadow: "0 -8px 18px rgb(0 0 0 / 0.45)" }}
            >
              <PirateButton
                size="lg"
                onClick={handleStartGame}
                disabled={!selectedShip || !playerName || playerName.length < 3 || loading}
                className="w-full sm:w-auto sm:min-w-[18rem]"
                data-testid="cypress-start-game-button"
              >
                {loading ? "Preparing Ship..." : "Set Sail!"}
              </PirateButton>
              {!playerName && (
                <p className="ptw-font-label text-ptw-brass-hi text-center">Enter your name first!</p>
              )}
              {nameTooShort && (
                <p className="ptw-font-label text-ptw-brass-hi text-center">Name must be at least 3 characters</p>
              )}
              {playerName && !nameTooShort && !selectedShip && (
                <p className="ptw-font-label text-ptw-brass-hi text-center">Pick a ship to sail</p>
              )}
            </div>
          </WoodPanel>
          <div className="h-16 shrink-0" aria-hidden="true" />
        </div>
      </div>
      <PirateButton
        variant="porthole"
        size="lg"
        onClick={() => setShowInstructions(true)}
        className="fixed top-3 right-3 sm:top-auto sm:bottom-5 sm:right-5 z-50"
        style={{
          marginBottom: "env(safe-area-inset-bottom, 0)",
          marginRight: "env(safe-area-inset-right, 0)",
        }}
        aria-label="Game instructions"
        title="Game instructions"
      >
        <HelpCircle />
      </PirateButton>
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
            amount={selectedShip ? SHIP_PRICES[selectedShip.name] : 0}
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