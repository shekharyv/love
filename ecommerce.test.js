const { computeTax, calculateOrderTotal } = require('./shared_utils');
const { processOrder } = require('./ecommerce');

function testTax() {
    console.assert(computeTax(100) === 5.00, 'Test 1: Normal tax (5%)');
    console.assert(computeTax(101) === 5.05, 'Test 2: Normal tax decimal');
    console.assert(computeTax(100.5) === 5.03, 'Test 3: Fractional tax rounding');
    console.log('✅ Tax tests passed');
}

function testOrderTotal() {
    const items = [
        { price: 10, quantity: 2 },
        { price: 5, quantity: 4 }
    ];
    // Subtotal = 20 + 20 = 40
    // Tax (5%) = 2.00
    // Total = 42.00
    console.assert(calculateOrderTotal(items) === 42.00, 'Test 4: Order total calculation');
    console.log('✅ Order total tests passed');
}

function testProcessOrder() {
    const order = processOrder('ORDER-123', [{ price: 10, quantity: 1 }], 'sh@example.com');
    console.assert(order.orderId === 'ORDER-123', 'Test 5: Order ID check');
    console.assert(order.total === 10.50, 'Test 6: Processed total check');
    console.log('✅ Process order tests passed');
}

try {
    testTax();
    testOrderTotal();
    testProcessOrder();
    console.log('\n🌟 ALL E-COMMERCE TESTS PASSED! 🌟');
} catch (e) {
    console.error('❌ TEST FAILED:', e.message);
}
