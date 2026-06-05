const products = [
  {
    id: 1,
    name: 'Mixed Fruit Juice',
    category: 'Juices',
    size: '200 ml',
    price: 25,
    image: 'https://i1.zopping.com/zopping-uploads/6026/images/640/20240118/SKU017114-20240118-114722.webp'
  },
  {
    id: 2,
    name: 'Guava Juice',
    category: 'Juices',
    size: '200 ml',
    price: 25,
    image: 'https://m.media-amazon.com/images/I/81rN2+4peCL._SX679_.jpg'
  },
  {
    id: 3,
    name: 'Cranberry Juice',
    category: 'Juices',
    size: '200 ml',
    price: 30,
    image: 'https://www.bbassets.com/media/uploads/p/l/40222034_3-b-natural-cranberry-flavoured-cooler-ready-to-serve-beverage.jpg'
  },
  {
    id: 4,
    name: 'Pomegranate Juice',
    category: 'Juices',
    size: '200 ml',
    price: 35,
    image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTdUAPQTjHxdlI6M0NkWeLx7YrTgsFuM1IzUQ&s'
  },
  {
    id: 5,
    name: 'Tender Coconut Water',
    category: 'Coconut Water',
    size: '200 ml',
    price: 28,
    image: 'https://www.bbassets.com/media/uploads/p/xl/40297921_5-b-natural-select-tender-coconut-water-no-added-sugar.jpg'
  },
  {
    id: 6,
    name: 'Coconut Water (No Sugar)',
    category: 'Coconut Water',
    size: '200 ml',
    price: 30,
    image: 'https://m.media-amazon.com/images/I/71eB6-hknyL.jpg'
  },
  {
    id: 7,
    name: 'Chocolate Milk',
    category: 'Dairy Beverages',
    size: '180 ml',
    price: 25,
    image: 'https://www.bbassets.com/media/uploads/p/l/40211835_6-sunfeast-chocolate-shake-with-real-belgian-chocolate.jpg'
  },
  {
    id: 8,
    name: 'Badam Milk',
    category: 'Dairy Beverages',
    size: '180 ml',
    price: 30,
    image: 'https://www.jiomart.com/images/product/original/491998912/sunfeast-badam-milkshake-180-ml-bottle-product-images-o491998912-p590323576-0-202203170503.jpg?im=Resize=(420,420)'
  },
  {
    id: 9,
    name: 'Strawberry Milk',
    category: 'Dairy Beverages',
    size: '180 ml',
    price: 28,
    image: 'https://m.media-amazon.com/images/I/71xR6rAdGgL._AC_UF894,1000_QL80_.jpg'
  },
  {
    id: 10,
    name: 'Mango Smoothie',
    category: 'Smoothies',
    size: '250 ml',
    price: 55,
    image: 'https://www.jiomart.com/images/product/original/494303633/sunfeast-mango-smoothie-with-mango-chunks-750-ml-product-images-o494303633-p608931891-0-202405081814.jpg?im=Resize=(1000,1000)'
  },
  {
    id: 11,
    name: 'Berry Blast Smoothie',
    category: 'Smoothies',
    size: '250 ml',
    price: 60,
    image: 'https://www.jiomart.com/images/product/original/494303632/sunfeast-mixed-berry-smoothie-300-ml-product-images-o494303632-p609207505-0-202406042022.jpg?im=Resize=(1000,1000)'
  },
  {
    id: 12,
    name: 'Banana Oats Smoothie',
    category: 'Smoothies',
    size: '250 ml',
    price: 58,
    image: 'https://www.jiomart.com/images/product/original/494303634/sunfeast-banana-oats-smoothie-300-ml-product-images-o494303634-p609207508-0-202406042022.jpg?im=Resize=(1000,1000)'
  },
  {
    id: 13,
    name: 'Sparkling Lime',
    category: 'New Additions',
    size: '250 ml',
    price: 35,
    image: 'https://m.media-amazon.com/images/I/71gPK8pb5oL._AC_UF1000,1000_QL80_.jpg'
  },
  {
    id: 14,
    name: 'Aloe Vera Drink',
    category: 'New Additions',
    size: '250 ml',
    price: 40,
    image: 'https://m.media-amazon.com/images/I/41kWftLujfL._AC_UF1000,1000_QL80_.jpg'
  },
  {
    id: 15,
    name: 'Energy Drink (Citrus)',
    category: 'New Additions',
    size: '250 ml',
    price: 45,
    image: 'https://m.media-amazon.com/images/I/61wraOUsPEL._AC_UF350,350_QL80_.jpg'
  },
  {
    id: 16,
    name: 'Tender Coconut Water',
    category: 'Coconut Water',
    size: '200 ml',
    price: 28,
    image: 'https://www.bbassets.com/media/uploads/p/xl/40297921_5-b-natural-select-tender-coconut-water-no-added-sugar.jpg'
  },
  {
    id: 17,
    name: 'Coconut Water (No Sugar)',
    category: 'Coconut Water',
    size: '200 ml',
    price: 30,
    image: 'https://m.media-amazon.com/images/I/71eB6-hknyL.jpg'
  },
  {
    id: 18,
    name: 'Tender Coconut Water',
    category: 'Coconut Water',
    size: '200 ml',
    price: 28,
    image: 'https://www.bbassets.com/media/uploads/p/xl/40297921_5-b-natural-select-tender-coconut-water-no-added-sugar.jpg'
  },
  {
    id: 19,
    name: 'Coconut Water (No Sugar)',
    category: 'Coconut Water',
    size: '200 ml',
    price: 30,
    image: 'https://m.media-amazon.com/images/I/71eB6-hknyL.jpg'
  }, 
  {
    id: 20,
    name: 'Tender Coconut Water',
    category: 'Coconut Water',
    size: '200 ml',
    price: 28,
    image: 'https://www.bbassets.com/media/uploads/p/xl/40297921_5-b-natural-select-tender-coconut-water-no-added-sugar.jpg'
  },
  {
    id: 21,
    name: 'Coconut Water (No Sugar)',
    category: 'Coconut Water',
    size: '200 ml',
    price: 30,
    image: 'https://m.media-amazon.com/images/I/71eB6-hknyL.jpg'
  },
  {
    id: 22,
    name: 'Tender Coconut Water',
    category: 'Coconut Water',
    size: '200 ml',
    price: 28,
    image: 'https://www.bbassets.com/media/uploads/p/xl/40297921_5-b-natural-select-tender-coconut-water-no-added-sugar.jpg'
  },
  {
    id: 23,
    name: 'Coconut Water (No Sugar)',
    category: 'Coconut Water',
    size: '200 ml',
    price: 30,
    image: 'https://m.media-amazon.com/images/I/71eB6-hknyL.jpg'
  },
  {
    id: 24,
    name: 'Tender Coconut Water',
    category: 'Coconut Water',
    size: '200 ml',
    price: 28,
    image: 'https://www.bbassets.com/media/uploads/p/xl/40297921_5-b-natural-select-tender-coconut-water-no-added-sugar.jpg'
  },
  {
    id: 25,
    name: 'Coconut Water (No Sugar)',
    category: 'Coconut Water',
    size: '200 ml',
    price: 30,
    image: 'https://m.media-amazon.com/images/I/71eB6-hknyL.jpg'
  },
  {
    id: 26,
    name: 'Tender Coconut Water',
    category: 'Coconut Water',
    size: '200 ml',
    price: 28,
    image: 'https://www.bbassets.com/media/uploads/p/xl/40297921_5-b-natural-select-tender-coconut-water-no-added-sugar.jpg'
  },
  {
    id: 27,
    name: 'Coconut Water (No Sugar)',
    category: 'Coconut Water',
    size: '200 ml',
    price: 30,
    image: 'https://m.media-amazon.com/images/I/71eB6-hknyL.jpg'
  },
];

module.exports = { products };
