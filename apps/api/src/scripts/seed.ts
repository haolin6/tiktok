import { createDbPool } from "../db/pool.js";
import { findDefaultStreamerId } from "../repositories/users-repository.js";

const pool = createDbPool();

try {
  await pool.execute(
    `INSERT INTO users (demo_key, nickname, role)
     VALUES
       ('demo_streamer', 'Demo 主播', 'streamer'),
       ('demo_user_1', '竞拍用户 A', 'bidder'),
       ('demo_user_2', '竞拍用户 B', 'bidder'),
       ('demo_user_3', '竞拍用户 C', 'bidder')
     ON DUPLICATE KEY UPDATE
       nickname = VALUES(nickname),
       role = VALUES(role)`
  );

  const streamerId = await findDefaultStreamerId(pool);

  await pool.execute(
    `INSERT INTO auction_rooms (demo_key, title, video_url, status, created_by)
     VALUES ('demo_room_main', 'Demo 直播间', '/demo/live-room-audience.png', 'active', ?)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title),
       video_url = VALUES(video_url),
       status = VALUES(status),
       created_by = VALUES(created_by)`,
    [streamerId]
  );

  console.log("Seeded demo streamer, bidders, and auction room.");
} finally {
  await pool.end();
}
