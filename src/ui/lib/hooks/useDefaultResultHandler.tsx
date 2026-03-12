import { errorResponseToMessage, GenericResult } from "@common/GenericError";
import { useMemo } from "react";
import { toast } from "../components/toast";

export type ResultHandlerResult = GenericResult<unknown> | { noResult: true };
export type ResultHandlerAdditional = {
  success?: () => void;
  error?: () => void;
  noToastOnSuccess?: boolean;
  nonError?: () => void;
};
export function useDefaultResultHandler() {
  return useMemo(() => {
    return {
      onResult: (
        result: ResultHandlerResult,
        additional?: ResultHandlerAdditional,
      ) => {
        if ("noResult" in result) {
          additional?.nonError?.();
          return;
        }
        if (result.success) {
          additional?.success?.();
          if (!additional?.noToastOnSuccess) {
            toast.show({
              severity: "success",
              message: "Başarıyla tamamlandı",
            });
          }
        } else {
          additional?.error?.();
          toast.show({
            severity: "error",
            message: errorResponseToMessage(result.error),
          });
        }
      },
      toast,
    };
  }, []);
}
