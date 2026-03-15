type $Maybe<T> = T | undefined | null;
type $ExpectNever<T extends never> = T;
type $AsyncReturnType<T extends (...args: any) => Promise<any>> = T extends (
  ...args: any
) => Promise<infer R>
  ? R
  : any;

type $Branded<T, K extends string> = T & { __brand: K };

type $DistributiveOmit<T, K extends PropertyKey> = T extends any
  ? Omit<T, K>
  : never;

declare module 'parse-curl' {
  type ParsedCurl = {
    method?: string;
    url?: string;
    header?: Record<string, string>;
    body?: string;
  };

  export default function parseCurl(value: string): ParsedCurl | undefined;
}
