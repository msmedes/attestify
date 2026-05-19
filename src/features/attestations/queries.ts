import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { answerWithAttestations, listQueryHistory } from "./api";

export function useSearchAttestations() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: answerWithAttestations,
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["query-history"] });
		},
	});
}

export function useQueryHistory() {
	return useQuery({
		queryKey: ["query-history"],
		queryFn: listQueryHistory,
	});
}
