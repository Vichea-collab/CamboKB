import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useMemo } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';

export type LatLng = { lat: number; lng: number };

// A CSS pin (no image assets, so nothing breaks after bundling).
const pin = L.divIcon({
  className: '',
  html: '<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;background:#ffb703;transform:rotate(-45deg);border:3px solid #14171c;box-shadow:0 4px 12px rgba(0,0,0,.5)"></div>',
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

function Recenter({ at }: { at: LatLng }) {
  const map = useMap();
  useEffect(() => {
    map.setView(at, Math.max(map.getZoom(), 15));
  }, [at, map]);
  return null;
}

function ClickToMove({ onChange }: { onChange: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onChange({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

/** OpenStreetMap with a draggable pin. Default export so checkout can lazy-load it. */
export default function MapPicker({ value, fallback, onChange }: { value: LatLng | null; fallback: LatLng; onChange: (p: LatLng) => void }) {
  const center = value ?? fallback;
  const handlers = useMemo(
    () => ({
      dragend: (e: L.LeafletEvent) => {
        const ll = (e.target as L.Marker).getLatLng();
        onChange({ lat: ll.lat, lng: ll.lng });
      },
    }),
    [onChange],
  );
  return (
    <div className="h-56 overflow-hidden rounded-xl border border-line sm:h-64">
      <MapContainer center={center} zoom={value ? 15 : 13} scrollWheelZoom={false} className="size-full" attributionControl>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
        <Marker position={center} draggable icon={pin} eventHandlers={handlers} />
        <ClickToMove onChange={onChange} />
        {value && <Recenter at={value} />}
      </MapContainer>
    </div>
  );
}
