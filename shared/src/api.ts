import { z } from 'zod';

// HTTP-API лобі: ту саму схему використовують сервер (на вході) і клієнт (на відповіді).
export const RoomInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  players: z.number().int().min(0),
  max: z.number().int().min(1),
});
export type RoomInfo = z.infer<typeof RoomInfoSchema>;

export const RoomListResponseSchema = z.object({ rooms: z.array(RoomInfoSchema) });
export type RoomListResponse = z.infer<typeof RoomListResponseSchema>;

export const CreateRoomRequestSchema = z.object({ name: z.string().trim().min(1).max(32) });
export type CreateRoomRequest = z.infer<typeof CreateRoomRequestSchema>;
