using Microsoft.EntityFrameworkCore;
using StagingArea.Api.Models;

namespace StagingArea.Api.Data
{
    public class StagingDbContext : DbContext
    {
        public StagingDbContext(DbContextOptions<StagingDbContext> options) : base(options)
        {
        }

        public DbSet<StagingCustomer> StagingCustomers => Set<StagingCustomer>();
        public DbSet<StagingOrder> StagingOrders => Set<StagingOrder>();

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<StagingCustomer>()
                .HasIndex(x => new { x.SourceSystem, x.ExternalId });

            modelBuilder.Entity<StagingOrder>()
                .HasIndex(x => new { x.SourceSystem, x.ExternalId });

            base.OnModelCreating(modelBuilder);
        }
    }
}


