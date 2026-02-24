import type { TisRequest } from '../types/tis-api';
import { parseDdMmYyyyHhmm } from '../utils/dateFormat';

export interface ParsedRequest {
  requestId: number;
  number: number;
  status: string;
  dateCreate: Date | null;
  dateProcessed: Date | null;
  contactPerson: string;
  rawJson: TisRequest;
}

export function parseRequest(raw: TisRequest): ParsedRequest {
  return {
    requestId:      raw.id,
    number:         raw.number,
    status:         raw.status,
    dateCreate:     parseDdMmYyyyHhmm(raw.dateCreate),
    dateProcessed:  parseDdMmYyyyHhmm(raw.dateProcessed),
    contactPerson:  raw.contactPerson,
    rawJson:        raw,
  };
}

export function parseRequests(rawList: TisRequest[]): ParsedRequest[] {
  return rawList.map(parseRequest);
}
