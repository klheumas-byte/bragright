import { useEffect, useRef } from "react";
import { subscribeRealtime } from "../services/realtime";

export default function useRealtimeRefresh(eventTypes, callback) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const eventKey = [...eventTypes].sort().join("|");

  useEffect(
    () => subscribeRealtime(eventKey.split("|"), (event) => callbackRef.current(event)),
    [eventKey]
  );
}
