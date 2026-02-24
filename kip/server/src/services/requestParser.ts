import type { TisRequest } from '../types/tis-api';
import type { ParsedRequest } from '../types/domain';
import { parseDdMmYyyyHhmm } from '../utils/dateFormat';

export function parseRequest(raw: TisRequest): ParsedRequest {
  return {
    requestId: raw.id,
    number: raw.number,
    status: raw.status,
    dateCreate: parseDdMmYyyyHhmm(raw.dateCreate),
    dateProcessed: parseDdMmYyyyHhmm(raw.dateProcessed),
    contactPerson: raw.contactPerson,
    rawJson: raw,
  };
}

export function parseRequests(rawList: TisRequest[]): ParsedRequest[] {
  return rawList.map(parseRequest);
}
