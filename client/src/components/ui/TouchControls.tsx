import React, { useEffect, useRef, useState } from 'react';
import nipplejs from 'nipplejs';
import { isMobile } from 'react-device-detect';
import { useKeyboardControls } from '@react-three/drei';

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
  bottom: '20%',
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
    console.log("device is touch", result)
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
      const { force, angle } = data;
      const threshold = 0.3;

      // Calculate movement directions
      const forward = Math.cos(angle.radian) * force;
      const right = Math.sin(angle.radian) * force;

      // Update shared controls ref
      controlsRef.current = {
        forward: forward > threshold,
        backward: forward < -threshold,
        left: right < -threshold,
        right: right > threshold,
        fire: controlsRef.current.fire,
      };

      // Update keyboard controls for consistency
      setControls((state) => ({
        ...state,
        forward: forward > threshold,
        backward: forward < -threshold,
        left: right < -threshold,
        right: right > threshold,
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