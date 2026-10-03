import { useQuery } from "@tanstack/react-query";
import type { Me } from "../../shared/api-types";
import { useApi } from "./use-api";

export function useMe() {
	const api = useApi();
	return useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me"), staleTime: 5 * 60_000 });
}

/** Admins edit; viewers are read-only (the API enforces this too — this only hides controls). */
export function useIsAdmin() {
	return useMe().data?.role === "admin";
}
