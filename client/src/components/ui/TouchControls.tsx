import React, { useEffect, useRef, useState } from 'react';
import nipplejs from 'nipplejs';
import { isMobile } from 'react-device-detect';
import { useKeyboardControls } from '@react-three/drei';
import { useGameState } from '@/lib/stores/useGameState';

// Interface for control state
interface ControlState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  fire: boolean;
}

// Styles for touch controls
const joystickStyle = {
  width: '100px',
  height: '100px',
  position: 'absolute',
  bottom: '22%',
  left: '20px',
};

interface TouchControlsProps {
  controlsRef: React.MutableRefObject<ControlState>;
}

const TouchControls: React.FC<TouchControlsProps> = ({ controlsRef }) => {
  const joystickRef = useRef(null);
  const [, setControls] = useKeyboardControls();
  const [isDeviceTouch, setIsDeviceTouch] = useState(false)

  useEffect(() => {
    function isTouchDevice() {
      return (('ontouchstart' in window) || (navigator.maxTouchPoints > 0))
    }
    let result = isTouchDevice();
    if (result) {
      setIsDeviceTouch(true)
    }
    //console.log("device is touch", result)
  }, [])

  useEffect(() => {
    // Initialize nipplejs joystick
    const manager = nipplejs.create({
      zone: joystickRef.current,
      mode: 'static',
      position: { left: '50%', top: '50%' },
      color: 'white',
    });

    // Map joystick movement to controls
    manager.on('move', (evt, data) => {
      const { vector } = data; // vector.x and vector.y are normalized (-1 to 1)
      const moveThreshold = 0.3; // Threshold for triggering movement
      const turnThreshold = 0.4; // Threshold for triggering turning

      //console.log("left:", vector.x < -turnThreshold, "right", vector.x > turnThreshold)
      // Update shared controls ref based on X/Y displacement
      controlsRef.current = {
        forward: vector.y > moveThreshold,   // Joystick up (positive Y)
        backward: vector.y < -moveThreshold, // Joystick down (negative Y)
        left: vector.x < -turnThreshold,     // Joystick left (negative X)
        right: vector.x > turnThreshold,     // Joystick right (positive X)
        fire: controlsRef.current.fire,
      };

      // Update keyboard controls for consistency
      setControls((state) => ({
        ...state,
        forward: vector.y > moveThreshold,
        backward: vector.y < -moveThreshold,
        left: vector.x < -turnThreshold,
        right: vector.x > turnThreshold,
        fire: controlsRef.current.fire
      }));
    });

    // Reset movement controls when joystick is released
    manager.on('end', () => {
      controlsRef.current = {
        ...controlsRef.current,
        forward: false,
        backward: false,
        left: false,
        right: false,
      };

      setControls((state) => ({
        ...state,
        forward: false,
        backward: false,
        left: false,
        right: false,
      }));
    });

    // Cleanup joystick
    return () => manager.destroy();
  }, [controlsRef, setControls]);

  return (
    <div>
      <div ref={joystickRef} style={joystickStyle} />
    </div>
  );
};

export default TouchControls;