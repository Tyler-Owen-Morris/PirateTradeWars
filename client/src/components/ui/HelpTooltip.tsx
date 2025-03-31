import { useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { 
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export function HelpTooltip() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <TooltipProvider>
        <Tooltip open={open} onOpenChange={setOpen}>
          <TooltipTrigger asChild>
            <button 
              className="p-2 bg-amber-700 text-white rounded-full shadow-lg hover:bg-amber-600 transition-colors"
              aria-label="Game controls help"
            >
              <HelpCircle className="h-6 w-6" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" align="end" className="w-80 p-4 bg-gray-900 text-white border-amber-500">
            <div>
              <h3 className="font-bold text-amber-400 mb-2">Game Controls</h3>
              <ul className="space-y-2 text-sm">
                <li className="flex justify-between">
                  <span>Move Forward:</span>
                  <span className="font-mono bg-gray-800 px-2 rounded">W or ↑</span>
                </li>
                <li className="flex justify-between">
                  <span>Move Backward:</span>
                  <span className="font-mono bg-gray-800 px-2 rounded">S or ↓</span>
                </li>
                <li className="flex justify-between">
                  <span>Turn Left:</span>
                  <span className="font-mono bg-gray-800 px-2 rounded">A or ←</span>
                </li>
                <li className="flex justify-between">
                  <span>Turn Right:</span>
                  <span className="font-mono bg-gray-800 px-2 rounded">D or →</span>
                </li>
                <li className="flex justify-between">
                  <span>Fire Cannons:</span>
                  <span className="font-mono bg-gray-800 px-2 rounded">Space</span>
                </li>
                <li className="flex justify-between">
                  <span>Increase Speed:</span>
                  <span className="font-mono bg-gray-800 px-2 rounded">Shift</span>
                </li>
                <li className="flex justify-between">
                  <span>Decrease Speed:</span>
                  <span className="font-mono bg-gray-800 px-2 rounded">Ctrl</span>
                </li>
                <li className="flex justify-between">
                  <span>Trade at Port:</span>
                  <span className="font-mono bg-gray-800 px-2 rounded">T</span>
                </li>
              </ul>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}