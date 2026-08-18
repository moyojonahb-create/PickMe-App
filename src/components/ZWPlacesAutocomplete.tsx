import React, { useState } from 'react';
import { MapPin, AlertCircle } from 'lucide-react';
import { useLandmarks } from '@/hooks/useLandmarks';

interface ZWPlacesAutocompleteProps {
  placeholder: string;
  defaultValue: string;
  onPick: (place: { lat: number; lng: number; label: string }) => void;
}

const ZWPlacesAutocomplete: React.FC<ZWPlacesAutocompleteProps> = ({
  placeholder,
  defaultValue,
  onPick,
}) => {
  const [value, setValue] = useState(defaultValue);
  const [isOpen, setIsOpen] = useState(false);

  const { landmarks, loading, error } = useLandmarks({ searchQuery: value, limit: 5 });

  return (
      <div className="relative">
        <div className="flex items-center gap-2 px-3 py-3 border border-gray-300 rounded-lg bg-white">
          <MapPin className="w-4 h-4 text-foreground flex-shrink-0" />
          <input
            type="text"
            placeholder={placeholder}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            onBlur={() => setTimeout(() => setIsOpen(false), 200)}
            className="flex-1 outline-none text-sm bg-transparent"
          />
        </div>

        {error && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-red-50 border border-red-200 rounded-lg p-2 flex items-center gap-2 text-xs text-red-600">
            <AlertCircle className="w-3 h-3 flex-shrink-0" />
            {error}
          </div>
        )}

        {isOpen && !error && landmarks && landmarks.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
            {landmarks.map((landmark, idx) => (
              <div
                key={idx}
                onClick={() => {
                  onPick({
                    lat: landmark.latitude,
                    lng: landmark.longitude,
                    label: landmark.name,
                  });
                  setValue(landmark.name);
                  setIsOpen(false);
                }}
                className="px-3 py-2 cursor-pointer hover:bg-gray-100 border-b last:border-b-0 text-sm"
              >
                {landmark.name}
              </div>
            ))}
          </div>
        )}

        {isOpen && loading && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg p-2 text-xs text-muted-foreground">
            Loading locations...
          </div>
        )}
      </div>
    );
};

export default ZWPlacesAutocomplete;
