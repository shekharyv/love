/**
 * LoveSync Shared Utils
 * Core logic for order processing and tax calculation.
 */

const computeTax = (amount, rate = 0.05) => {
    if (amount < 0) throw new Error("Amount cannot be negative");
    return Math.round(amount * rate * 100) / 100;
};

const calculateOrderTotal = (items, taxRate = 0.05) => {
    const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const tax = computeTax(subtotal, taxRate);
    return subtotal + tax;
};

module.exports = { computeTax, calculateOrderTotal };
