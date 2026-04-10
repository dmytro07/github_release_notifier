declare global {
  namespace Express {
    interface Request {
      isPublic?: boolean;
    }
  }
}

export {};
