declare global {
  namespace Express {
    interface Request {
      driverId?: string;
    }
  }
}

export {};
