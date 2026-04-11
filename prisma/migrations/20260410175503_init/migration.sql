-- CreateTable
CREATE TABLE "repositories" (
    "id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "last_seen_tag" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmation_token" TEXT NOT NULL,
    "unsubscribe_token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "repository_id" TEXT NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "repositories_owner_repo_key" ON "repositories"("owner", "repo");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_confirmation_token_key" ON "subscriptions"("confirmation_token");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_unsubscribe_token_key" ON "subscriptions"("unsubscribe_token");

-- CreateIndex
CREATE INDEX "subscriptions_confirmation_token_idx" ON "subscriptions"("confirmation_token");

-- CreateIndex
CREATE INDEX "subscriptions_unsubscribe_token_idx" ON "subscriptions"("unsubscribe_token");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_email_repository_id_key" ON "subscriptions"("email", "repository_id");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
