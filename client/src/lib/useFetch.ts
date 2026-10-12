import { useEffect, useRef, useState } from "react";

type FetchState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: T; updatedAt: number };

/**
 * Small fetch-on-mount hook shared by every dashboard section, so each one
 * gets the same loading/error/success handling without repeating it.
 * `deps` works like useEffect's dependency array — pass `[]` for
 * fetch-once-on-mount, or include values that should trigger a re-fetch.
 * A successful state also carries `updatedAt` (epoch ms) — when the data
 * arrived — which the section headers show as "updated HH:MM".
 */
export function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[] = []): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({ status: "loading" });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    fetcherRef
      .current()
      .then((data) => {
        if (!cancelled) setState({ status: "success", data, updatedAt: Date.now() });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Something went wrong.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}