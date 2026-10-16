import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { MAP_WIDTH, MAP_HEIGHT } from "../../lib/constants";

interface FogProps {
    color?: string;
    near?: number;
    far?: number;
}

export function Fog({ color = "#b3d9ff", near = 300, far = 2000 }: FogProps) {
    const { scene } = useThree();

    useEffect(() => {
        // Use regular fog instead of exponential fog
        // near - objects start to be affected by fog at this distance
        // far - objects completely disappear in fog at this distance
        const fog = new THREE.Fog(color, near, far);
        scene.fog = fog;

        // Clean up fog when component unmounts
        return () => {
            scene.fog = null;
        };
    }, [scene, color, near, far]);

    // This component doesn't render anything visible directly
    return null;
} 