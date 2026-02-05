import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  CircleMarker,
  Polygon,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import type { LatLngExpression, Map as LeafletMap } from "leaflet";

type LatLon = { lat: number; lon: number };
type Trap = { id: string; lat: number; lon: number; label: string };
type LKP = { id: string; lat: number; lon: number; timeISO: string; label?: string };

type EnvelopePolys = {
  core: LatLon[];
  fringe: LatLon[];
  residual: LatLon[];
};

type Band = {
  minutes: number;
  polygons: EnvelopePolys;
  confidence_score: number;
  confidence_band: string;
};

type StartPoint = { label: string; point: LatLon };

type Props = {
  center: LatLngExpression;
  zoom: number;
  onMapClick: (lat: number, lon: number) => void;
  onMapReady: (map: LeafletMap) => void;
  onViewChanged: (map: LeafletMap) => void;

  showUserLocation: boolean;
  followUser: boolean;
  locateToken: number;
  centerOnMeToken: number;
  onUserLocation?: (lat: number, lon: number) => void;

  showEnvelope: boolean;
  envelopeNow: EnvelopePolys | null;
  envelopeBands: Band[] | null;
  startPoints?: StartPoint[] | null;

  traps: Trap[];
  lkps: LKP[];
  activeLkpId: string | null;
};

function polyToTuples(poly: LatLon[]) {
  return poly.map((p) => [p.lat, p.lon] as [number, number]);
}

function MapEvents({
  onMapClick,
  onViewChanged,
}: {
  onMapClick: (lat: number, lon: number) => void;
  onViewChanged: (map: LeafletMap) => void;
}) {
  const map = useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
    moveend() {
      onViewChanged(map);
    },
    zoomend() {
      onViewChanged(map);
    },
  });
  return null;
}

function UserLocator({
  showUserLocation,
  followUser,
  locateToken,
  centerOnMeToken,
  onUserLocation,
}: {
  showUserLocation: boolean;
  followUser: boolean;
  locateToken: number;
  centerOnMeToken: number;
  onUserLocation?: (lat: number, lon: number) => void;
}) {
  const map = useMap();
  const [pos, setPos] = useState<LatLon | null>(null);

  const isInteractingRef = useRef(false);
  const lastCenterTokenRef = useRef<number>(centerOnMeToken);

  useEffect(() => {
    const onDragStart = () => (isInteractingRef.current = true);
    const onDragEnd = () => (isInteractingRef.current = false);

    map.on("dragstart", onDragStart);
    map.on("dragend", onDragEnd);
    map.on("zoomstart", onDragStart);
    map.on("zoomend", onDragEnd);

    return () => {
      map.off("dragstart", onDragStart);
      map.off("dragend", onDragEnd);
      map.off("zoomstart", onDragStart);
      map.off("zoomend", onDragEnd);
    };
  }, [map]);

  useEffect(() => {
    if (!showUserLocation) return;

    map.locate({
      setView: false,
      watch: false,
      enableHighAccuracy: true,
      maximumAge: 30_000,
      timeout: 10_000,
    });

    const onFound = (e: any) => {
      const lat = e?.latlng?.lat;
      const lon = e?.latlng?.lng;
      if (typeof lat !== "number" || typeof lon !== "number") return;

      setPos({ lat, lon });
      onUserLocation?.(lat, lon);

      // one-time recenter only when token changes
      if (centerOnMeToken !== lastCenterTokenRef.current) {
        lastCenterTokenRef.current = centerOnMeToken;
        map.setView([lat, lon], map.getZoom(), { animate: true });
        return;
      }

      // follow only if enabled AND user isn't actively interacting
      if (followUser && !isInteractingRef.current) {
        map.setView([lat, lon], map.getZoom(), { animate: true });
      }
    };

    const onError = () => {};

    map.on("locationfound", onFound);
    map.on("locationerror", onError);

    return () => {
      map.off("locationfound", onFound);
      map.off("locationerror", onError);
    };
  }, [map, showUserLocation, followUser, locateToken, centerOnMeToken, onUserLocation]);

  if (!showUserLocation || !pos) return null;

  return (
    <CircleMarker center={[pos.lat, pos.lon]} radius={8} pathOptions={{}}>
      <Popup>Your location</Popup>
    </CircleMarker>
  );
}

export default function LeafletMapInner(props: Props) {
  const tileUrl = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
  const attrib =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

  const icon = useMemo(() => {
    return L.icon({
      iconUrl:
        "data:image/svg+xml;charset=UTF-8," +
        encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26"><circle cx="13" cy="13" r="10" fill="#111827" stroke="white" stroke-width="2"/></svg>`
        ),
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    });
  }, []);

  return (
    <MapContainer
      center={props.center}
      zoom={props.zoom}
      style={{ width: "100%", height: "100%" }}
      whenReady={() => {
        // react-leaflet expects () => void
      }}
      ref={(instance) => {
        if (instance) props.onMapReady(instance as unknown as LeafletMap);
      }}
    >
      <TileLayer url={tileUrl} attribution={attrib} />

      <MapEvents onMapClick={props.onMapClick} onViewChanged={props.onViewChanged} />

      <UserLocator
        showUserLocation={props.showUserLocation}
        followUser={props.followUser}
        locateToken={props.locateToken}
        centerOnMeToken={props.centerOnMeToken}
        onUserLocation={props.onUserLocation}
      />

      {/* LKPs */}
      {props.lkps.map((k) => (
        <Marker key={k.id} position={[k.lat, k.lon]} icon={icon}>
          <Popup>
            <b>{k.label ?? "LKP"}</b>
            <div style={{ fontSize: 12, opacity: 0.85 }}>{new Date(k.timeISO).toLocaleString()}</div>
            {props.activeLkpId === k.id ? <div style={{ marginTop: 6 }}>(active)</div> : null}
          </Popup>
        </Marker>
      ))}

      {/* Traps */}
      {props.traps.map((t) => (
        <Marker key={t.id} position={[t.lat, t.lon]} icon={icon}>
          <Popup>
            <b>Trap:</b> {t.label}
          </Popup>
        </Marker>
      ))}

      {/* Envelope now */}
      {props.showEnvelope && props.envelopeNow && (
        <>
          <Polygon positions={polyToTuples(props.envelopeNow.residual)} pathOptions={{}} />
          <Polygon positions={polyToTuples(props.envelopeNow.fringe)} pathOptions={{}} />
          <Polygon positions={polyToTuples(props.envelopeNow.core)} pathOptions={{}} />
        </>
      )}

      {/* Bands (residual outlines) */}
      {props.showEnvelope &&
        props.envelopeBands &&
        props.envelopeBands.map((b) => (
          <Polygon key={b.minutes} positions={polyToTuples(b.polygons.residual)} pathOptions={{}} />
        ))}

      {/* Start points */}
      {props.startPoints?.map((p, idx) => (
        <Marker key={`${p.label}_${idx}`} position={[p.point.lat, p.point.lon]} icon={icon}>
          <Popup>{p.label}</Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
