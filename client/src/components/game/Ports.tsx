import { useEffect, useState } from 'react';
import { Port as PortType } from '@/types';
import { Port } from './Port';
import { apiRequest } from '@/lib/queryClient';
import { DEFAULT_PORTS } from '@shared/gameConstants';

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
