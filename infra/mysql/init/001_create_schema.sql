CREATE DATABASE IF NOT EXISTS live_auction
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE live_auction;

CREATE TABLE IF NOT EXISTS environment_probe (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  demo_key VARCHAR(64) NULL UNIQUE,
  nickname VARCHAR(80) NOT NULL,
  role ENUM('streamer', 'bidder') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  title VARCHAR(160) NOT NULL,
  image_url VARCHAR(512) NULL,
  description TEXT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_products_created_by
    FOREIGN KEY (created_by) REFERENCES users (id),
  INDEX idx_products_created_by (created_by),
  INDEX idx_products_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auction_rooms (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  demo_key VARCHAR(64) NULL UNIQUE,
  title VARCHAR(160) NOT NULL,
  video_url VARCHAR(512) NULL,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_auction_rooms_created_by
    FOREIGN KEY (created_by) REFERENCES users (id),
  INDEX idx_auction_rooms_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auctions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  room_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  start_price DECIMAL(12, 2) NOT NULL,
  increment_step DECIMAL(12, 2) NOT NULL,
  ceiling_price DECIMAL(12, 2) NULL,
  start_at DATETIME(3) NOT NULL,
  end_at DATETIME(3) NOT NULL,
  extend_threshold_sec INT UNSIGNED NOT NULL DEFAULT 10,
  extend_duration_sec INT UNSIGNED NOT NULL DEFAULT 10,
  status ENUM('Draft', 'Scheduled', 'Running', 'Sold', 'Passed', 'Canceled') NOT NULL DEFAULT 'Scheduled',
  current_price DECIMAL(12, 2) NOT NULL,
  current_winner_id BIGINT UNSIGNED NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_auctions_room
    FOREIGN KEY (room_id) REFERENCES auction_rooms (id),
  CONSTRAINT fk_auctions_product
    FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT fk_auctions_current_winner
    FOREIGN KEY (current_winner_id) REFERENCES users (id),
  CONSTRAINT fk_auctions_created_by
    FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_auctions_prices
    CHECK (
      start_price >= 0
      AND increment_step > 0
      AND current_price >= 0
      AND (ceiling_price IS NULL OR ceiling_price >= start_price)
    ),
  CONSTRAINT chk_auctions_time
    CHECK (end_at > start_at),
  INDEX idx_auctions_status (status),
  INDEX idx_auctions_room_status (room_id, status),
  INDEX idx_auctions_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bids (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  auction_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  request_id VARCHAR(96) NOT NULL,
  accepted BOOLEAN NOT NULL DEFAULT FALSE,
  reject_reason VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_bids_auction
    FOREIGN KEY (auction_id) REFERENCES auctions (id),
  CONSTRAINT fk_bids_user
    FOREIGN KEY (user_id) REFERENCES users (id),
  UNIQUE KEY uniq_bids_request (auction_id, user_id, request_id),
  INDEX idx_bids_auction_amount (auction_id, amount),
  INDEX idx_bids_user_created_at (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  auction_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  buyer_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  status ENUM('pending_payment', 'paid', 'canceled') NOT NULL DEFAULT 'pending_payment',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_auction
    FOREIGN KEY (auction_id) REFERENCES auctions (id),
  CONSTRAINT fk_orders_product
    FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT fk_orders_buyer
    FOREIGN KEY (buyer_id) REFERENCES users (id),
  UNIQUE KEY uniq_orders_auction (auction_id),
  INDEX idx_orders_buyer (buyer_id),
  INDEX idx_orders_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auction_events (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  auction_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(80) NOT NULL,
  payload_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_auction_events_auction
    FOREIGN KEY (auction_id) REFERENCES auctions (id),
  INDEX idx_auction_events_auction_created_at (auction_id, created_at),
  INDEX idx_auction_events_type_created_at (event_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
