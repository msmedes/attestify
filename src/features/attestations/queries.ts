import { useMutation } from "@tanstack/react-query";
import { answerWithAttestations } from "./api";

export function useSearchAttestations() {
	return useMutation({
		mutationFn: answerWithAttestations,
	});
}
