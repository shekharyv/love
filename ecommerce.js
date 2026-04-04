const { calculateOrderTotal } = require('./shared_utils');

const processOrder = (orderId, items, customerEmail) => {
    console.log(`Processing Order: ${orderId} for ${customerEmail}`);
    const total = calculateOrderTotal(items);

    if (total <= 0) throw new Error("Order total must be greater than 0");

    return {
        orderId,
        customerEmail,
        items,
        total,
        status: 'PROCESSED',
        timestamp: new Date()
    };
};

module.exports = { processOrder };
