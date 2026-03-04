import { IUser } from "../types/user.types";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      user?: IUser;
    }
  }
}