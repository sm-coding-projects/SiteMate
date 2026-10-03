import { useAuth } from "@clerk/react";
import { useCallback } from "react";
import { apiFetch } from "@/lib/api";

export function useApi() {
	const { getToken } = useAuth();
	return useCallback(<T>(path: string, init?: RequestInit) => apiFetch<T>(path, getToken, init), [getToken]);
}
