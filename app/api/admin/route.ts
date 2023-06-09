import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { stripe } from '@/utils/stripe';
import { upsertProductRecord } from '@/utils/supabase-admin';
import { Database } from '@/types_db';
import { log } from 'next-axiom';
import { v4 as uuidv4 } from 'uuid';

export async function POST(req: Request) {

  // todo: add auth check
  const requestId = uuidv4();

  const body = await req.text();
  const action = JSON.parse(body).action;
  const supabase = createRouteHandlerClient<Database>({ cookies });

  log.info('Admin API called.', { action: action, requestId: requestId });

  switch (action) {
    case 'stripe-sync-products': {
      let products_updates = 0;
      let products_deletes = 0;
      log.info('Admin API: Syncing Stripe Products', { requestId: requestId });
      const allStripeProducts = await stripe.products.list();
      if (allStripeProducts.lastResponse.statusCode != 200) {
        log.error(`Error fetching products from Stripe.`, {
          statusCode: allStripeProducts.lastResponse.statusCode,
          requestId: requestId
        });
        throw new Error('Error fetching products from Stripe.');
      }

      // iterate over the product
      for (const product of allStripeProducts.data) {
        log.info(`Upserting product ${product.id}`, { requestId: requestId, product: product.id });
        // product does not exist, create it
        await upsertProductRecord(product);
        products_updates++;
      }

      const allActiveDbProducts = await supabase.from('products').select('*').eq('active', true);
      if (allActiveDbProducts.error != null) {
        log.error(`Error fetching products from database`, { error: allActiveDbProducts.error, requestId: requestId });
        throw new Error('Error fetching products from database.');
      }

      for (const dbProduct of allActiveDbProducts.data) {
        // check if the dbProduct exists in Stripe
        if (allStripeProducts.data.find(p => p.id == dbProduct.id) == null) {
          log.info(`Updating product ${dbProduct.id}`, { requestId: requestId, product: dbProduct.id });
          // product does not exist, delete it

          const updateRes = await supabase.from('public.products').update({ active: false }).eq('id', dbProduct.id);

          if (updateRes.error != null) {
            log.error(`Error updating product.`, {
              productId: dbProduct.id,
              error: updateRes.error,
              statusText: updateRes.statusText,
              requestId: requestId
            });
            throw new Error('Error updating product.');
          }

          if (updateRes.count == 0) {
            log.error(`No rows updated.`, { requestId: requestId, productId: dbProduct.id });
          }
          log.info(`Updated product ${dbProduct.id}`, { requestId: requestId, product: dbProduct.id, rows_updated: updateRes.count, status: updateRes.status })

          /*
          const prices_deletion = await supabase.from('prices').delete().eq('product_id', dbProduct.id);
          if (prices_deletion.error != null) {
            log.error(`Error deleting prices.`, {
              productId: dbProduct.id,
              error: prices_deletion.error,
              statusText: prices_deletion.statusText,
              requestId: requestId,
            });
            throw new Error("Error deleting prices.");

          }

          const deletion = await supabase.from('products').delete().eq('id', dbProduct.id);
          if (deletion.error != null) {
            log.error(`Error deleting product.`, {
              productId: dbProduct.id,
              error: deletion.error,
              statusText: deletion.statusText,
              requestId: requestId,
            });
            throw new Error("Error deleting product.");
          }

           */
          products_deletes++;
        }
      }
      return new Response(JSON.stringify({ products_updates, products_deletes, requestId }), { status: 200 });
    }
  }

  throw new Error('Unknown action.');

}