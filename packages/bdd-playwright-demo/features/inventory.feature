Feature: Product Inventory
  As a logged-in shopper
  I want to browse and manage products
  So that I can build my cart before checkout

  Background:
    Given I am logged in as "standard_user"

  @smoke
  Scenario: Products page displays all available items
    Then I should see 6 products on the page

  @regression
  Scenario: Adding a product updates the cart badge
    When I add "sauce-labs-backpack" to the cart
    Then the cart badge should show "1"

  @regression
  Scenario: Adding multiple products updates the badge count
    When I add "sauce-labs-backpack" to the cart
    And I add "sauce-labs-bike-light" to the cart
    Then the cart badge should show "2"

  @regression
  Scenario Outline: Products can be sorted by different criteria
    When I sort products by "<sort_value>"
    Then the first product listed should be "<first_product>"

    Examples:
      | sort_value | first_product                    |
      | za         | Test.allTheThings() T-Shirt (Red) |
      | lohi       | Sauce Labs Onesie                |
