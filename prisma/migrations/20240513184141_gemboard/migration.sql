/*
  Warnings:

  - You are about to drop the `Post` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Profile` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Post" DROP CONSTRAINT "Post_authorId_fkey";

-- DropForeignKey
ALTER TABLE "Profile" DROP CONSTRAINT "Profile_userId_fkey";

-- DropTable
DROP TABLE "Post";

-- DropTable
DROP TABLE "Profile";

-- DropTable
DROP TABLE "User";

-- CreateTable
CREATE TABLE "message" (
    "snowflake" BIGINT NOT NULL,

    CONSTRAINT "message_pkey" PRIMARY KEY ("snowflake")
);

-- CreateTable
CREATE TABLE "user" (
    "snowflake" BIGINT NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("snowflake")
);

-- CreateTable
CREATE TABLE "user_message" (
    "user_id" BIGINT NOT NULL,
    "message_id" BIGINT NOT NULL,

    CONSTRAINT "user_message_pkey" PRIMARY KEY ("user_id","message_id")
);

-- CreateTable
CREATE TABLE "starboard_message" (
    "snowflake" BIGINT NOT NULL,
    "author_id" BIGINT NOT NULL,
    "channel_id" BIGINT NOT NULL,
    "guild_id" BIGINT NOT NULL,
    "message_id" BIGINT NOT NULL,

    CONSTRAINT "starboard_message_pkey" PRIMARY KEY ("snowflake","author_id","channel_id","guild_id","message_id")
);

-- AddForeignKey
ALTER TABLE "user_message" ADD CONSTRAINT "user_message_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("snowflake") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_message" ADD CONSTRAINT "user_message_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message"("snowflake") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "starboard_message" ADD CONSTRAINT "starboard_message_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message"("snowflake") ON DELETE CASCADE ON UPDATE CASCADE;
