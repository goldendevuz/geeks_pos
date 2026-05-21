### Geeks POS - Home Appliance Business Customization Technical Specification

# Executive Summary

This document provides a comprehensive technical specification for customizing the Geeks POS system from a fashion retail POS to a home appliance retail POS tailored for the Uzbekistan market. The current system is designed specifically for clothing/shoes retail with size and color variants, which must be fundamentally restructured for home appliance retail. This specification covers all architectural changes, database migrations, API modifications, and frontend transformations required to implement the new business requirements.

The existing system architecture consists of a Django REST backend with SQLite/PostgreSQL database, React/TypeScript frontend with Vite and Tailwind CSS, and Tauri desktop wrapper for offline-first desktop application deployment. The current product model uses Category (Brand) → Product (Model) → ProductVariant (Size + Color) hierarchy, which will need to be restructured to remove size/color variants entirely and introduce optional product name fields, flexible pricing with admin overrides, and supplier debt tracking. This analysis examines every logical component, data model, API endpoint, and user interface element that requires modification, providing a complete roadmap for the customization effort.

The home appliance business in Uzbekistan has distinct operational requirements that differ significantly from fashion retail. Products are identified primarily by brand and model rather than size and color, pricing involves complex calculations including markup percentages and manual overrides at point of sale, supplier relationships require tracking accounts payable and receivable, and inventory management must support low-stock alerts at both individual product and brand/model aggregation levels. These requirements necessitate fundamental changes to the data model, business logic, and user interface of the existing system.


# 1. Current System Analysis

# 1.1 Technology Stack Overview

The Geeks POS system is built on a modern technology stack designed for offline-first retail operations. The backend uses Django 4.x with Django REST Framework, providing a robust REST API with JWT and session-based authentication. The database layer supports SQLite for local offline operation and PostgreSQL for cloud deployment with automatic synchronization between local and cloud databases. The frontend is built with React 18, TypeScript, and Vite for fast development and bundling, with Tailwind CSS for styling and Zustand for state management. The desktop application wrapper uses Tauri (Rust-based) enabling cross-platform desktop deployment with native system integration including receipt printing and barcode scanner support.

The system currently implements a fashion-specific product model where products are organized in a three-level hierarchy: Category (representing brands like Nike, Adidas), Product (representing specific models like Air Max 90), and ProductVariant (representing specific size/color combinations like Size 42 / Black). Each variant maintains its own barcode, purchase price, list price, and stock quantity. This model is deeply embedded throughout the codebase, from database models and serializers to frontend components and business logic functions.

The sales flow is optimized for fashion retail with rapid barcode scanning, size/color matrix selection at checkout, and customer debt tracking for fashion items. The current inventory movement system tracks all stock changes through the InventoryMovement model, recording inbound stock (purchases), outbound stock (sales), adjustments, and returns. The debt system tracks customer credit through the Debt model, with payments recorded separately and integrated into the cash register reconciliation.

# 1.2 Data Model Deep Dive
The catalog module contains the core product data structures. The Category model stores brand information with bilingual name fields (name_uz and name_ru), sort order for display prioritization, and soft delete capability. The Product model represents individual models within a brand, similarly with bilingual names and active status flags. The ProductVariant model is the central entity for inventory management, containing barcode (auto-generated or manual), purchase_price, list_price, stock_qty, size reference, color reference, and timestamps for creation and modification. The Variant model enforces uniqueness constraints on product+size+color combinations and includes a check constraint ensuring stock_qty is non-negative.

The inventory module tracks all stock movements through InventoryMovement, which records the type of movement (IN, SALE, OUT, RETURN, ADJUST), quantity change, reference to sale (for sales and returns), optional note, creation timestamp, and user who performed the action. The StocktakeSession and StocktakeLine models support periodic inventory counting with variance tracking. This inventory model will require significant modification to work without size/color variants.

The sales module contains Sale (header information with status, cashier, totals), SaleLine (individual items with quantities and prices), Payment (payment methods: CASH, CARD, DEBT), and SaleRefund (returns with refund method and reason). The current sales flow enforces list_price at checkout time - the sale cannot proceed without a defined list_price on each variant. This will need to change to allow optional list_price entry at sale time.

The debt module contains Customer (name, normalized phone for uniqueness, optional note) and Debt (customer reference, originating sale, total/paid/remaining amounts, due date, status). This system tracks customer debts only - supplier debts are not currently implemented and must be added as new functionality.

The expenses module contains ShopExpense with amount, category (RENT, UTILITIES, SUPPLIES, SALARY, OTHER), note, and recorded_by user reference. Expenses currently reduce cash but are not integrated with any cash register reconciliation system. The requirement to subtract expenses from the cash register requires integration with the shift/cash tracking system.

# 1.3 Frontend Architecture Analysis
The frontend consists of multiple page components and shared UI elements. The CatalogPage handles product management with a complex wizard interface for adding products in bulk using size/color matrix. The wizard has three steps: brand/model selection, color selection, and size/price/qty matrix entry. The product table displays variants with product name, size/color combination, barcode, stock, price, and action buttons for edit, print sticker, toggle active, and delete. The low stock warning currently shows products where total stock across all variants is less than 3.

The PosPage implements the point-of-sale interface with product search (barcode scanner or manual search), cart management with quantity adjustment, payment method selection (CASH, CARD, DEBT), customer selection for debt sales, and order discount application. The current POS flow requires list_price to be defined for each product before it can be sold - there's no option to enter price at sale time.

The ExpensesPage provides simple expense entry with amount, category, and note fields, plus a table showing historical expenses with date filtering. The DebtsPage shows customer debts grouped by customer with total outstanding, payment recording, and reminder sending capabilities.

1.4 Business Logic Implementation
The backend implements several key business logic components that will require modification. The catalog services handle product/variant creation, bulk operations, and barcode allocation. The sales services handle complete sale workflow including idempotency checking, inventory deduction, payment recording, and debt creation for DEBT payment method. The inventory services track all stock movements and calculate current stock levels. The debt services calculate outstanding balances, handle payments, and manage debt status transitions.

Price calculations currently work as follows: purchase_price represents the cost from supplier, list_price represents the retail selling price, and profit is calculated as list_price minus purchase_price multiplied by quantity. The +/- calculation at sale time is not implemented - prices are fixed at product definition time.

# 2. Features Analysis and Classification

# 2.1 Features to REMOVE
The following features are specific to fashion retail and must be removed or disabled for home appliance business:

The Size model and all size-related functionality must be removed. The current system enforces size selection in the product wizard and uses sizes as a core dimension of ProductVariant. Home appliances do not have sizes in the traditional sense - products are identified by brand and model only. The Size model should either be completely removed from the database schema or repurposed to store something else if needed. All frontend components that display size selection (the wizard step 3 matrix, size dropdowns in filters, size columns in tables) must be removed or hidden.

The Color model and all color-related functionality must be removed. Similar to sizes, home appliances don't use color as a product dimension in the same way fashion does. While some appliances come in different colors (e.g., a refrigerator in white or stainless steel), this is better handled as an optional product attribute rather than a core dimension. The Color model should be removed or repurposed, and all frontend color selection components must be removed.

The size/color matrix wizard (wizard step 3) must be completely redesigned or replaced. Currently this wizard allows batch entry of products across all sizes for a selected color - a workflow optimized for shoe stores receiving inventory in bulk for multiple sizes. Home appliance inventory typically comes as individual units or small quantities of specific models, not bulk size runs.

The low stock threshold calculation based on variant count must be changed. Currently the system calculates low stock as products with total stock across all variants less than 3. For home appliances, the requirement is to calculate based on model or brand aggregation and trigger when stock falls below 2.

# 2.2 Features to ADD

The following new features are required for the home appliance business:

A custom product name field must be added to the Product model. Currently products have name_uz and name_ru fields which represent the model name (e.g., "Samsung RB33R"). The requirement is to add an optional custom product name that can override or supplement the model name, particularly useful when the model name is too technical or when additional product information needs to be displayed (e.g., "Samsung Refrigerator 330L No Frost").

A flexible pricing system must be implemented where list_price is optional at product definition time. The purchase_price (kelish narxi) should always be required as it represents the cost from supplier, but list_price (sotish narxi) should be optional. When a product is sold, the cashier should be able to enter the selling price at that time, with the system calculating +/- against the purchase price. Admin users should have the ability to edit selling prices after sales are completed.

A price display toggle for labels must be implemented. Currently the label/sticker printing always includes the price. The new requirement allows optional display of price on stickers - the store should be able to configure whether price appears on printed labels. This requires adding a configuration option and conditional logic in the label generation.if user chooses to print the price as well , it will be printed only when the product sell_price is exist , it will not  be printed or choosed for the products which has no sell_price 

An optional selling price visibility setting must be added. Some stores may not want to display selling prices in the catalog or POS interface, perhaps for negotiation flexibility. This requires a global configuration option and conditional display logic throughout the frontend.

Expense integration with cash register must be implemented. Currently expenses are recorded but not connected to the cash drawer system. The new requirement is to record expenses and have them automatically subtracted from the cash register balance. This requires creating a link between ShopExpense and the shift/cash tracking functionality, updating the cash reconciliation calculations.

Supplier debt tracking must be added as a new module. The current debt system only tracks customer (buyer) debts. The new requirement is to track supplier (provider) debts and credits - money owed to suppliers for purchased inventory, and credits from suppliers for returns or overpayments. This requires creating new data models (Supplier, SupplierTransaction), new API endpoints, and new frontend pages.the UX and UX need to be POS friend ly , touch friendly

A one-click low stock view button must be added to the inventory interface. Currently low stock warnings are shown in the catalog page but not prominently displayed. The requirement is to add a dedicated button that shows all products with low stock (less than 2 units) with filtering by brand or model.

The low stock calculation logic must be updated to aggregate by model and brand. Currently it calculates at the individual variant level. The new system should calculate total stock per model and per brand, showing items that fall below the threshold of 2 units.

# 2.3 Features to CHANGE
The following existing features require significant modification:

The product variant model must be simplified. Currently ProductVariant includes size and color foreign keys which are required. For home appliances, the variant should represent a single unique product (unique barcode) without size/color dimensions. The model should be refactored so that size and color are optional or removed entirely, and each product has one variant (or optionally multiple variants for different configurations like color options).

The product wizard must be redesigned from a three-step size/color matrix to a simpler form. Step 1 should remain brand/model selection but with the additional optional custom name field. Step 2 should be removed (color selection) or repurposed for product configuration. Step 3 should become simple entry of purchase price, optional initial selling price, and initial stock quantity - no matrix, just single row entry per model.

The catalog table display must be updated. Currently columns show product name, size/color combination, barcode, stock, price, and actions. For home appliances, the display should show product name (with optional custom name display), brand, model, barcode, stock (aggregated), purchase price, and optional selling price.

The POS flow must be modified to allow price entry at sale time. Currently the system requires list_price to be defined before a product can be added to cart. The new flow should allow products without list_price to be added, with a prompt to enter price when adding to cart. The price entry should show the purchase price and calculate +/- percentage for reference.

The inventory movement system must be adapted for the new product model. Since there are no size/color variants, inventory movements should track at the product/variant level directly without dimension references.

The label/sticker printing must support optional price display. The current printing template always includes price - this needs to become conditional based on configuration and possibly per-product setting.

The barcode generation logic may need adjustment. Currently barcodes are auto-generated with a specific pattern - this may need review for home appliance inventory where barcodes might come from manufacturer labels or be assigned differently.

### 3. Detailed Technical Implementation
3.1 Database Schema Changes
The following database migrations are required:

Create a new field on the Product model for custom product name. Add fields: custom_name_uz (CharField, nullable, max_length=255), custom_name_ru (CharField, nullable, max_length=255). These fields store the optional custom product name that displays instead of or alongside the model name.

Add fields to ProductVariant for optional selling price support. Add fields: show_price_on_label (BooleanField, default=True), hide_selling_price (BooleanField, default=False). These boolean fields control price visibility and label display.

Modify ProductVariant to make size and color optional. The current schema has size and color as ForeignKey with on_delete=PROTECT (required). Change to allow null values: size = models.ForeignKey(Size, on_delete=models.SET_NULL, null=True, blank=True), color = models.ForeignKey(Color, on_delete=models.SET_NULL, null=True, blank=True). Alternatively, for full removal, remove these fields entirely and create a new simplified variant model, but nullability is safer for migration.

Create new Supplier models. Create new model Supplier with fields: id (UUID), name (CharField), phone (CharField, nullable), address (TextField, nullable), note (CharField, nullable), created_at (DateTime), is_active (Boolean). Create SupplierTransaction model with fields: id (UUID), supplier (ForeignKey to Supplier), type (choice: DEBT/CREDIT), amount (DecimalField), related_purchase (ForeignKey to Purchase, nullable), note (CharField, nullable), created_at (DateTime), created_by (ForeignKey to User).

Create new PurchaseOrder model for tracking inventory purchases from suppliers. Fields: id (UUID), supplier (ForeignKey), items (JSONField or ManyToMany to variant), total_amount (DecimalField), status (choice: PENDING/COMPLETED/CANCELLED), created_at (DateTime), recorded_by (ForeignKey to User).

Create new cash register integration model. Add field to ShopExpense: related_shift (ForeignKey, nullable). This links expenses to specific cash register shifts for reconciliation.

### 3.2 Backend API Changes
The following API endpoints require modification:

Modify GET /api/catalog/variants/ to exclude size/color fields when empty. Add filter parameters for low_stock_threshold (show variants with stock_qty < 2), brand_id (filter by category), model_id (filter by product).

Add new endpoint GET /api/catalog/products/low-stock/ that returns products with stock below threshold, grouped by brand and model with aggregated totals.

Modify POST /api/catalog/variants/bulk-create/ to accept simplified input without size/color. The current matrix input should accept single variant creation with: product_id, purchase_price, list_price (optional), initial_qty, barcode (optional).

Modify POST /api/sales/complete/ to accept optional price override per line. Currently sale lines require list_unit_price from variant. New logic: if variant.list_price is null, accept price from request, validate against purchase_price, calculate and store the entered price.

Add new endpoints for supplier management: GET/POST /api/suppliers/ (list/create), GET/PUT/DELETE /api/suppliers/{id}/, GET/POST /api/suppliers/{id}/transactions/.

Add new endpoints for supplier debts: GET /api/suppliers/debts/ (list all supplier balances), POST /api/suppliers/{id}/payment/ (record payment to supplier).

Modify GET /api/expenses/ to include shift information in response and allow filtering by shift_id.

Add new endpoint POST /api/shift/{id}/expense/ to record expense directly against a shift, automatically updating cash register balance.

# 3.3 Frontend Component Changes
The following frontend modifications are required:

CatalogPage redesign: Remove size and color wizard steps entirely. Replace wizard step 3 (matrix) with simple form: purchase price input, initial list price input (optional), initial quantity input, barcode input (optional). Add custom name input field in step 1 (model selection). Add low-stock view button in the filter section - clicking it opens a modal/panel showing all products with stock < 2. Update table columns: remove size/color column, add brand column (from category), add purchase price column, make selling price conditional based on configuration.

PosPage modification: Add price entry modal when adding product without list_price. Show purchase_price as reference, allow cashier to enter selling price. Display +/- percentage calculated from purchase_price. Validate that selling price is entered before completing sale. Add configuration option in settings to show/hide selling price in product search results.

ExpensesPage integration: Add shift selector when creating expense. Show cash register impact when viewing expense history - display how much was subtracted from cash. Add "subtract from register" indicator in the expense form.

New SupplierDebtsPage: Create new admin page for supplier debt management. Display list of suppliers with total debt/credit balance. Show transaction history per supplier. Form to record new purchase (increases debt), payment (decreases debt), return (creates credit). Display running balance with visual indicators (red for debt, green for credit).

SettingsPage: Add new configuration options: "Show price on labels" (boolean, default true), "Show selling price in catalog" (boolean, default true), "Low stock threshold" (integer, default 2).

# 3.4 Business Logic Modifications
The following backend business logic changes are required:

Price calculation at sale time: When completing a sale, if variant.list_price is null, use the price provided in the sale request. Store the actual selling price in SaleLine.net_unit_price. Calculate profit as (selling_price - purchase_price) * quantity. Update profit reporting to handle null list_price scenarios.

Admin price edit capability: Add a new API endpoint PATCH /api/sales/{id}/line/{line_id}/price/ that allows admin users to modify the selling price of a sale line after the sale is completed. This should update the SaleLine record and recalculate sale totals and profit.

Cash register expense deduction: When recording a ShopExpense, automatically link it to the current active shift (if any). Update the shift's cash balance calculation to subtract expenses. The shift closing report should show: starting cash + cash sales + cash received from debts - expenses = closing cash.

Supplier debt calculation: Implement a function get_supplier_balance(supplier_id) that returns total debt - total credit for a supplier. Implement get_all_suppliers_balance() that returns all suppliers with non-zero balances. These functions should be used for dashboard display and supplier debt page.

Low stock aggregation: Implement get_low_stock_by_brand(threshold) that groups products by category (brand) and sums stock_qty, returning brands where total stock < threshold. Implement get_low_stock_by_model(threshold) that returns products where stock_qty < threshold.

## 4. Implementation Priority and Roadmap
# 4.1 Phase 1: Core Data Model Changes
The first phase should focus on fundamental data model changes that other features depend on:

First, implement the database migrations: add custom_name fields to Product, add price visibility flags to ProductVariant, make size/color optional on ProductVariant. Create migration script to handle existing data - products with multiple variants should be flattened or archived.

Second, update the product wizard in frontend: remove size/color steps, add custom name field, simplify variant entry form. Test that new products can be created without size/color information.

Third, update catalog display: modify table columns and filters to work with new model. Verify existing products display correctly after migration.

# 4.2 Phase 2: Sales Flow Changes
The second phase should implement the flexible pricing system:

First, modify the POS to handle products without list_price: add price entry modal, validate price entry, store entered price in sale. Test that sales complete successfully with both pre-defined and sale-time prices.

Second, implement admin price edit capability: create API endpoint, update frontend to show edit option for admin users, test that price changes reflect in totals and profit calculations.

Third, update profit reporting: modify reports to handle null purchase_price and sale-time pricing scenarios correctly.

# 4.3 Phase 3: New Features
The third phase should implement the completely new features:

First, implement supplier management: create Supplier model, CRUD endpoints, transaction model. Create frontend page for supplier management.

Second, implement supplier debt tracking: create debt/credit transaction flow, balance calculation, payment recording. Create frontend supplier debts page with transaction history.

Third, implement expense/cash integration: link expenses to shifts, update shift cash calculation. Add shift selector to expense form, update expense history display.

Fourth, implement label configuration: add settings for price display, update label printing logic to respect settings. Test label printing with and without price.

# 4.4 Phase 4: Inventory Improvements
The fourth phase should implement inventory-related enhancements:

First, implement low stock button: add button to catalog, create low stock view with brand/model aggregation. Filter by brand and model.

Second, update low stock calculation: modify from variant-level to model-level aggregation. Update threshold to 2 as specified.

Third, add supplier selection to purchase recording: when receiving inventory, record which supplier it came from, create supplier transaction automatically.

# 5. Risk Assessment and Mitigation
# 5.1 Data Migration Risks
The transition from fashion-specific to appliance-specific data model carries significant migration risk. The size and color data currently in the database has no equivalent in the appliance model. The recommended approach is to create a data migration script that either archives the old data to a separate table for potential later retrieval, or provides an export function to dump the data before migration. All production data should be backed up before running migration. The migration should be tested on a copy of production data before deployment.

# 5.2 Breaking API Changes
Modifying the variant creation API and sale completion API may break existing integrations. The recommendation is to maintain backward compatibility where possible - for example, if size/color fields are optional but still accepted in API requests, existing integrations will continue to work. API versioning could be implemented if major changes are needed. All API changes should be documented and communicated to any API consumers.

# 5.3 User Training Requirements
The workflow changes from size/color matrix to simple product entry and the new price-at-sale-time flow represent significant changes for existing users. The recommendation is to create user documentation in Uzbek and Russian explaining the new workflows. Consider adding in-app help tooltips explaining new features. Plan for a transition period where both old and new workflows could potentially be supported if needed.

# 5.4 Performance Considerations
Adding aggregation queries for low stock by brand and model may impact performance on large datasets. The recommendation is to add database indexes on the fields used for aggregation (product_id, category_id, stock_qty). Consider caching the low stock calculations if they become expensive. Monitor query performance after deployment and optimize as needed.

# 6. Testing Strategy
# 6.1 Unit Testing
All new backend functions should have unit tests covering normal operation and edge cases. Critical functions requiring tests include: price calculation with null list_price, supplier balance calculation, low stock aggregation, expense-shift integration. Frontend components should have snapshot tests or unit tests for complex logic.

# 6.2 Integration Testing
Integration tests should cover the complete workflows: product creation without size/color, sale with sale-time price entry, supplier debt transaction flow, expense deduction from cash register. API integration tests should verify that all endpoints accept valid payloads and return appropriate errors for invalid data.

# 6.3 User Acceptance Testing
A UAT checklist should be created covering: catalog wizard produces valid products, POS completes sales with and without pre-defined prices, supplier debt page shows correct balances, expense form links to shift correctly, low stock button shows correct products, label printing respects configuration.


### 7. Configuration and Settings
# 7.1 New Configuration Options

The following configuration options should be added to the settings system:

Setting Name	Type	Default	Description
show_price_on_labels	boolean	true	Whether to display price on printed stickers
show_selling_price_catalog	boolean	true	Whether to display selling price in catalog and POS
low_stock_threshold	integer	2	Number of units below which stock is considered low
require_price_at_sale	boolean	true	Whether to require price entry at sale time if not pre-defined

The detailed technical specification above covers all your requirements. Let me provide a quick summary of the key changes needed:

Features to REMOVE:

Size model and all size-related functionality
Color model and all color-related functionality
Size/color matrix wizard (step 3)
Low stock calculation based on variant count
Features to ADD:

Custom product name field (beyond brand/model)
Flexible pricing: purchase price required, selling price optional
Price entry at sale time with +/- calculation
Admin ability to edit selling prices after sale
Label price display toggle
Expense integration with cash register
Supplier debt/credit tracking (new module)
One-click low stock view button
Low stock calculation by brand/model (threshold: 2)
Features to CHANGE:

ProductVariant: simplify (remove required size/color)
Catalog wizard: 3-step matrix → simple form
POS flow: allow sale without pre-defined price
Inventory: aggregate by model/brand instead of variant
The specification includes database migrations, API changes, frontend components, business logic modifications, implementation phases, risk assessment, and testing strategy.

### Q&A

# Questions
# 1. Size/Color Handling:

Should I completely remove the Size and Color models, or just make them optional (nullable) in ProductVariant?
If removing: What's the plan for existing data? Archive to backup table or delete?
# 2. Existing Products:

Do you have existing test/demo data in the system that I should preserve?
Or can I reset/clear the database for the new structure?
# 3. Supplier Debt Details:

Should suppliers have their own page in the admin sidebar?
What information should appear in the supplier list (name, phone, total debt/credit)?
How do we record a purchase from supplier - through the catalog or separate purchase order?
# 4. Expense Integration:

Is there an existing "Shift" or "Cash Register" module? I need to understand how to integrate expenses with it.
Or should I create a simple cash tracking system from scratch?
# 5. Code Standards:

Are there specific patterns/conventions used in this codebase I should follow?
Should I write tests for the new functionality?
Any specific naming conventions for new models/endpoints?
# 6. Priority Order:

Which features should I implement first? (Suggested: data model → catalog → POS → suppliers → expenses → inventory)

### Answers
# 1 Remove, what did you mean by it ?
# 2 you can make clear strucutre , and clear databse 
# 3 and admin make records of suppliers , and can see how much debt they have from specific supplier , the supplier will be added in that page and the supplied products will be added , how much debt , how much total prducts price fromt hem , when payment is made etc are required , make the best optimal , POS system firnedly , solutions, for keeping the accountibality first choice , 
# 4 look for expances if they exist you can use them iofthey not make another section for it 
# 5 identofy from the code itself 
# 6 choose optimal solution 