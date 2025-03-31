import { useEffect, useState } from 'react';
import { Port as PortType } from '@/types';
import { Port } from './Port';
import { apiRequest } from '@/lib/queryClient';

// Default ports if API call fails
const DEFAULT_PORTS: PortType[] = [
  { id: 1, name: "Tortuga", x: 1000, y: 0, z: 1200, safeRadius: 200 },
  { id: 2, name: "Port Royale", x: 4000, y: 0, z: 300, safeRadius: 200 },
  { id: 3, name: "Nassau", x: 2500, y: 0, z: 4500, safeRadius: 200 },
  { id: 4, name: "Havana", x: 4200, y: 0, z: 4000, safeRadius: 200 },
  { id: 5, name: "Kingston", x: 800, y: 0, z: 3500, safeRadius: 200 },
  { id: 6, name: "Santo Domingo", x: 2800, y: 0, z: 1500, safeRadius: 200 },
  { id: 7, name: "Barbados", x: 1500, y: 0, z: 2500, safeRadius: 200 },
  { id: 8, name: "Puerto Rico", x: 3500, y: 0, z: 2800, safeRadius: 200 }
];

export function Ports() {
  const [ports, setPorts] = useState<PortType[]>([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    // Load ports from API
    const loadPorts = async () => {
      try {
        setLoading(true);
        const response = await apiRequest('GET', '/api/ports', undefined);
        const portsData = await response.json();
        
        if (Array.isArray(portsData) && portsData.length > 0) {
          setPorts(portsData);
        } else {
          // Fallback to default ports if API returns empty
          setPorts(DEFAULT_PORTS);
        }
      } catch (error) {
        console.error('Failed to load ports, using defaults:', error);
        setPorts(DEFAULT_PORTS);
      } finally {
        setLoading(false);
      }
    };
    
    loadPorts();
  }, []);
  
  if (loading) return null;
  
  return (
    <>
      {ports.map(port => (
        <Port key={port.id} port={port} />
      ))}
    </>
  );
}
