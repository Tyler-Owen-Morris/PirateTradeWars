import { useState } from 'react';
import { HelpCircle, X } from 'lucide-react';

export function HelpTooltip() {
  const [showControls, setShowControls] = useState(false);

  return (
    <>
      {/* Help button */}
      <div className="fixed bottom-4 right-4 z-50">
        <button 
          className="p-3 bg-amber-700 text-white rounded-full shadow-lg hover:bg-amber-600 transition-colors"
          aria-label="Game controls help"
          onClick={() => setShowControls(true)}
        >
          <HelpCircle className="h-6 w-6" />
        </button>
      </div>
      
      {/* Controls help modal */}
      {showControls && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-gray-900 text-white p-6 rounded-lg shadow-xl border-2 border-amber-500 max-w-md w-full">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-amber-400">Game Controls</h2>
              <button 
                onClick={() => setShowControls(false)}
                className="text-gray-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="col-span-2 pb-2 border-b border-amber-800">
                <h3 className="text-sm font-semibold text-amber-300">Ship Movement</h3>
              </div>
              
              <div className="text-sm">Move Forward (Ship Direction)</div>
              <div className="text-sm font-mono bg-gray-800 px-2 py-1 rounded text-center">W / ↑</div>
              
              <div className="text-sm">Move Backward (Reverse)</div>
              <div className="text-sm font-mono bg-gray-800 px-2 py-1 rounded text-center">S / ↓</div>
              
              <div className="text-sm">Turn Left</div>
              <div className="text-sm font-mono bg-gray-800 px-2 py-1 rounded text-center">A / ←</div>
              
              <div className="text-sm">Turn Right</div>
              <div className="text-sm font-mono bg-gray-800 px-2 py-1 rounded text-center">D / →</div>
              
              <div className="col-span-2 pb-2 mt-2 border-b border-amber-800">
                <h3 className="text-sm font-semibold text-amber-300">Combat & Speed</h3>
              </div>
              
              <div className="text-sm">Fire Cannons</div>
              <div className="text-sm font-mono bg-gray-800 px-2 py-1 rounded text-center">Space</div>
              
              <div className="text-sm">Increase Speed</div>
              <div className="text-sm font-mono bg-gray-800 px-2 py-1 rounded text-center">Shift</div>
              
              <div className="text-sm">Decrease Speed</div>
              <div className="text-sm font-mono bg-gray-800 px-2 py-1 rounded text-center">Ctrl</div>
              
              <div className="col-span-2 pb-2 mt-2 border-b border-amber-800">
                <h3 className="text-sm font-semibold text-amber-300">Game Interface</h3>
              </div>
              
              <div className="text-sm">Trade at Port</div>
              <div className="text-sm font-mono bg-gray-800 px-2 py-1 rounded text-center">T</div>
              
              <div className="text-sm">View Leaderboard</div>
              <div className="text-sm font-mono bg-gray-800 px-2 py-1 rounded text-center">Tab</div>
              
              <div className="text-sm">Toggle Controls Panel</div>
              <div className="text-sm font-mono bg-gray-800 px-2 py-1 rounded text-center">H</div>
            </div>
            
            <div className="mt-4 text-center">
              <button 
                onClick={() => setShowControls(false)}
                className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 transition-colors"
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