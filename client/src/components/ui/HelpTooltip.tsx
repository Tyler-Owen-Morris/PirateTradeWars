import { useState } from 'react';
import { HelpCircle, X } from 'lucide-react';

export function HelpTooltip() {
  const [showControls, setShowControls] = useState(false);

  return (
    <>
      {/* Help button */}
      <div className="fixed bottom-4 right-4 z-50">
        <button
          className="ptw-btn ptw-btn--porthole ptw-btn--lg"
          aria-label="Game controls help"
          onClick={() => setShowControls(true)}
        >
          <HelpCircle className="h-6 w-6" />
        </button>
      </div>

      {/* Controls help modal */}
      {showControls && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3">
          <div className="ptw-wood p-6 max-w-md w-full">
            <div className="flex justify-between items-center mb-4">
              <h2 className="ptw-font-display text-3xl text-ptw-brass-hi">Game Controls</h2>
              <button
                onClick={() => setShowControls(false)}
                className="ptw-btn ptw-btn--porthole ptw-btn--sm"
                aria-label="Close controls help"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="col-span-2 pb-1 border-b border-ptw-brass/40">
                <h3 className="ptw-font-label text-base text-ptw-brass-hi">Ship Movement</h3>
              </div>

              <div className="text-sm">Move Forward (Ship Direction)</div>
              <div className="text-sm text-center"><kbd className="ptw-kbd">W / ↑</kbd></div>

              <div className="text-sm">Move Backward (Reverse)</div>
              <div className="text-sm text-center"><kbd className="ptw-kbd">S / ↓</kbd></div>
              
              <div className="text-sm">Auto-sail (W or S to stop)</div>
              <div className="text-sm text-center"><kbd className="ptw-kbd">W W (double-tap)</kbd></div>

              <div className="text-sm">Turn Left</div>
              <div className="text-sm text-center"><kbd className="ptw-kbd">A / ←</kbd></div>

              <div className="text-sm">Turn Right</div>
              <div className="text-sm text-center"><kbd className="ptw-kbd">D / →</kbd></div>

              <div className="col-span-2 pb-1 mt-2 border-b border-ptw-brass/40">
                <h3 className="ptw-font-label text-base text-ptw-brass-hi">Combat & Speed</h3>
              </div>

              <div className="text-sm">Fire All Loaded Cannons</div>
              <div className="text-sm text-center"><kbd className="ptw-kbd">Space / F</kbd></div>

              <div className="text-sm">Fire Left (Port) Broadside</div>
              <div className="text-sm text-center"><kbd className="ptw-kbd">Q</kbd></div>

              <div className="text-sm">Fire Right (Starboard) Broadside</div>
              <div className="text-sm text-center"><kbd className="ptw-kbd">E</kbd></div>

              <div className="text-sm">Increase Speed</div>
              <div className="text-sm text-center"><kbd className="ptw-kbd">Shift</kbd></div>

              <div className="text-sm">Decrease Speed</div>
              <div className="text-sm text-center"><kbd className="ptw-kbd">Ctrl</kbd></div>

              <div className="col-span-2 pb-1 mt-2 border-b border-ptw-brass/40">
                <h3 className="ptw-font-label text-base text-ptw-brass-hi">Game Interface</h3>
              </div>

              <div className="text-sm">Trade at Port</div>
              <div className="text-sm text-center"><kbd className="ptw-kbd">T</kbd></div>

              <div className="text-sm">View Leaderboard</div>
              <div className="text-sm text-center"><kbd className="ptw-kbd">Tab</kbd></div>

              <div className="text-sm">Chat</div>
              <div className="text-sm text-center"><kbd className="ptw-kbd">Enter</kbd></div>

              <div className="text-sm">Toggle Controls Panel</div>
              <div className="text-sm text-center"><kbd className="ptw-kbd">H</kbd></div>
            </div>

            <div className="mt-4 text-center">
              <button
                onClick={() => setShowControls(false)}
                className="ptw-btn ptw-btn--brass"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}