// Gift cards (admin: Gift cards). Business logic only; every query is scoped by shopId.
// The balance changes only through `record`, which locks the card's row and writes the transaction that explains the change.
import { randomInt } from 'node:crypto'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import type { Conn } from '@shopnex/db'
import { shops } from '@shopnex/core/schema'
import { GiftCardError } from './gift-cards.errors'
import { giftCards, giftCardTransactions, type GiftCard, type GiftCardTransactionKind } from './gift-cards.schema'

export type IssueInput = {
  amountCents: number
  recipientEmail?: string | null
  expiresAt?: Date | null
  note?: string | null
  purchaseOrderId?: string | null
}

// No 0/O or 1/I/L: codes are read out and typed by people
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 16

/** What a buyer typed → the stored form: upper case, letters and digits only ("abcd-efgh" → "ABCDEFGH") */
export const normalizeCode = (raw: string) => raw.replace(/[^a-z0-9]/gi, '').toUpperCase()

/** "ABCDEFGHJKMNPQRS" → "ABCD-EFGH-JKMN-PQRS" */
export const formatCode = (code: string) => code.replace(/(.{4})(?=.)/g, '$1-')

export function generateCode(): string {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)]
  return code
}

export async function list(shopId: string, conn: Conn) {
  return conn.select().from(giftCards).where(eq(giftCards.shopId, shopId)).orderBy(desc(giftCards.createdAt))
}

export async function getById(shopId: string, id: string, conn: Conn) {
  const [card] = await conn
    .select()
    .from(giftCards)
    .where(and(eq(giftCards.shopId, shopId), eq(giftCards.id, id)))
  if (!card) return null
  const transactions = await conn
    .select()
    .from(giftCardTransactions)
    .where(eq(giftCardTransactions.giftCardId, id))
    .orderBy(asc(giftCardTransactions.createdAt))
  return { ...card, transactions }
}

// Case-insensitive, dashes and spaces ignored; null when the shop has no such card
export async function findByCode(shopId: string, code: string, conn: Conn) {
  const [card] = await conn
    .select()
    .from(giftCards)
    .where(and(eq(giftCards.shopId, shopId), eq(giftCards.code, normalizeCode(code))))
  return card ?? null
}

/** Why a card can't be spent right now (null = it can) */
export function unavailableReason(card: GiftCard, now = new Date()): string | null {
  if (!card.active) return 'This gift card has been disabled'
  if (card.expiresAt && card.expiresAt <= now) return 'This gift card has expired'
  if (card.balanceCents <= 0) return 'This gift card has no balance left'
  return null
}

/** How much of `dueCents` the card pays: the whole of it, or the card's balance when that is less */
export const coverage = (card: Pick<GiftCard, 'balanceCents'>, dueCents: number) =>
  Math.max(0, Math.min(card.balanceCents, dueCents))

// Locks the card, applies the change and writes the transaction. The one place a balance moves.
async function record(
  tx: Conn,
  shopId: string,
  id: string,
  kind: GiftCardTransactionKind,
  deltaCents: number,
  extra: { orderId?: string | null; note?: string | null } = {},
) {
  const [card] = await tx
    .select()
    .from(giftCards)
    .where(and(eq(giftCards.shopId, shopId), eq(giftCards.id, id)))
    .for('update')
  if (!card) throw new GiftCardError('GIFT_CARD_NOT_FOUND', 'Gift card not found')
  const balanceCents = card.balanceCents + deltaCents
  if (balanceCents < 0) {
    throw new GiftCardError('INSUFFICIENT_BALANCE', 'The gift card does not hold that much')
  }
  const [updated] = await tx
    .update(giftCards)
    .set({ balanceCents, updatedAt: new Date() })
    .where(eq(giftCards.id, id))
    .returning()
  await tx.insert(giftCardTransactions).values({
    giftCardId: id,
    kind,
    amountCents: deltaCents,
    balanceAfterCents: balanceCents,
    orderId: extra.orderId ?? null,
    note: extra.note ?? null,
  })
  return updated!
}

// Issues a card with a fresh code. Pass `conn` to run inside an outer transaction (an order being paid).
export async function issue(shopId: string, input: IssueInput, conn: Conn) {
  if (!Number.isInteger(input.amountCents) || input.amountCents < 1) {
    throw new GiftCardError('INVALID_GIFT_CARD', 'Enter an amount above zero, in whole cents')
  }
  return conn.transaction(async (tx) => {
    const [shop] = await tx.select({ currency: shops.currency }).from(shops).where(eq(shops.id, shopId))
    if (!shop) throw new GiftCardError('GIFT_CARD_NOT_FOUND', 'Shop not found')
    const [card] = await tx
      .insert(giftCards)
      .values({
        shopId,
        code: generateCode(),
        currency: shop.currency,
        initialCents: input.amountCents,
        balanceCents: 0,
        expiresAt: input.expiresAt ?? null,
        recipientEmail: input.recipientEmail?.trim() || null,
        purchaseOrderId: input.purchaseOrderId ?? null,
        note: input.note?.trim() || null,
      })
      .returning()
    return record(tx, shopId, card!.id, 'issue', input.amountCents, {
      orderId: input.purchaseOrderId,
      note: input.note,
    })
  })
}

// Staff switch a card off or on; its balance and history stay. Null when it isn't in this shop.
export async function setActive(shopId: string, id: string, active: boolean, conn: Conn) {
  const [card] = await conn
    .update(giftCards)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(giftCards.shopId, shopId), eq(giftCards.id, id)))
    .returning()
  return card ?? null
}

// Staff correct a balance (a mistake, a goodwill top-up). `deltaCents` is signed and can't take the balance below zero.
export async function adjust(shopId: string, id: string, deltaCents: number, note: string | null, conn: Conn) {
  if (!Number.isInteger(deltaCents) || deltaCents === 0) {
    throw new GiftCardError('INVALID_GIFT_CARD', 'Enter an amount, in whole cents, that is not zero')
  }
  return conn.transaction((tx) => record(tx, shopId, id, 'adjust', deltaCents, { note }))
}

// Spends `amountCents` of the card on an order. Runs in the order's transaction: if the order isn't kept, neither is the spend.
export async function redeem(tx: Conn, shopId: string, id: string, amountCents: number, orderId: string) {
  if (!Number.isInteger(amountCents) || amountCents < 1) {
    throw new GiftCardError('INVALID_GIFT_CARD', 'Redeem an amount above zero, in whole cents')
  }
  // Re-checked under the lock: the cart looked at the card earlier, another order may have emptied it since
  const [card] = await tx
    .select()
    .from(giftCards)
    .where(and(eq(giftCards.shopId, shopId), eq(giftCards.id, id)))
    .for('update')
  if (!card) throw new GiftCardError('GIFT_CARD_NOT_FOUND', 'Gift card not found')
  const reason = unavailableReason(card)
  if (reason) throw new GiftCardError('GIFT_CARD_UNAVAILABLE', reason)
  return record(tx, shopId, id, 'redeem', -amountCents, { orderId })
}

// Puts back what an order spent (the order was cancelled or refunded)
export async function refund(tx: Conn, shopId: string, id: string, amountCents: number, orderId: string) {
  if (!Number.isInteger(amountCents) || amountCents < 1) {
    throw new GiftCardError('INVALID_GIFT_CARD', 'Refund an amount above zero, in whole cents')
  }
  return record(tx, shopId, id, 'refund', amountCents, { orderId })
}

export async function removeMany(shopId: string, ids: string[], conn: Conn) {
  if (!ids.length) return 0
  const deleted = await conn
    .delete(giftCards)
    .where(and(eq(giftCards.shopId, shopId), inArray(giftCards.id, ids)))
    .returning({ id: giftCards.id })
  return deleted.length
}
